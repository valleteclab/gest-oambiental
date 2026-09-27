import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "./db";
import { registrarAuditoria } from "./audit";
import { isInterno, type UsuarioSessao } from "./rbac";

// Sessão: JWT curto de acesso (15 min) + refresh (8 h), cookies Secure/HttpOnly/SameSite=Lax (SPEC 3 / 9.3).
export const COOKIE_ACESSO = "lg_access";
export const COOKIE_REFRESH = "lg_refresh";
const ACESSO_SEG = 15 * 60;
const REFRESH_SEG = 8 * 60 * 60;
const MAX_FALHAS = 5;
const BLOQUEIO_MIN = 15;

const segredo = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");

export async function hashSenha(senha: string) {
  return hash(senha, { algorithm: 2 /* argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verificarSenha(hashSalvo: string, senha: string) {
  try {
    return await verify(hashSalvo, senha);
  } catch {
    return false;
  }
}

export function validarPoliticaSenha(senha: string): string | null {
  if (senha.length < 10) return "A senha deve ter pelo menos 10 caracteres.";
  return null;
}

export async function assinarToken(sub: string, tipo: "access" | "refresh") {
  return new SignJWT({ typ: tipo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${tipo === "access" ? ACESSO_SEG : REFRESH_SEG}s`)
    .sign(segredo());
}

export async function verificarToken(token: string | undefined, tipo: "access" | "refresh"): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, segredo());
    return payload.typ === tipo && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const opcoesCookie = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export async function criarSessao(usuarioId: string) {
  const c = await cookies();
  c.set(COOKIE_ACESSO, await assinarToken(usuarioId, "access"), opcoesCookie(ACESSO_SEG));
  c.set(COOKIE_REFRESH, await assinarToken(usuarioId, "refresh"), opcoesCookie(REFRESH_SEG));
}

export async function encerrarSessao() {
  const c = await cookies();
  c.delete(COOKIE_ACESSO);
  c.delete(COOKIE_REFRESH);
}

export async function contextoRequisicao() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    user_agent: h.get("user-agent"),
  };
}

type ResultadoLogin = { ok: true; usuario: UsuarioSessao } | { ok: false; erro: string };

export async function autenticar(email: string, senha: string): Promise<ResultadoLogin> {
  const ctx = await contextoRequisicao();
  const u = await prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
  const falha = async (motivo: string, usuarioId?: string) => {
    await registrarAuditoria({ usuario_id: usuarioId ?? null, acao: "LOGIN_FALHA", entidade: "usuario", entidade_id: usuarioId ?? null, depois: { email, motivo }, ...ctx });
    return { ok: false as const, erro: "E-mail ou senha inválidos." };
  };
  if (!u) return falha("usuario_inexistente");
  if (!u.ativo) return falha("usuario_inativo", u.id);
  if (u.bloqueado_ate && u.bloqueado_ate > new Date()) {
    await registrarAuditoria({ usuario_id: u.id, acao: "LOGIN_BLOQUEADO", entidade: "usuario", entidade_id: u.id, ...ctx });
    return { ok: false, erro: `Conta bloqueada temporariamente após ${MAX_FALHAS} tentativas. Tente novamente em alguns minutos.` };
  }
  if (!(await verificarSenha(u.senha_hash, senha))) {
    const falhas = u.falhas_login + 1;
    await prisma.usuario.update({
      where: { id: u.id },
      data: { falhas_login: falhas >= MAX_FALHAS ? 0 : falhas, bloqueado_ate: falhas >= MAX_FALHAS ? new Date(Date.now() + BLOQUEIO_MIN * 60000) : null },
    });
    return falha(falhas >= MAX_FALHAS ? "senha_incorreta_bloqueado" : "senha_incorreta", u.id);
  }
  await prisma.usuario.update({ where: { id: u.id }, data: { falhas_login: 0, bloqueado_ate: null, ultimo_login: new Date() } });
  await registrarAuditoria({ usuario_id: u.id, acao: "LOGIN", entidade: "usuario", entidade_id: u.id, ...ctx });
  const usuario = await carregarUsuario(u.id);
  return usuario ? { ok: true, usuario } : { ok: false, erro: "Usuário inválido." };
}

export async function carregarUsuario(id: string): Promise<UsuarioSessao | null> {
  const u = await prisma.usuario.findUnique({ where: { id }, include: { papeis: true } });
  if (!u || !u.ativo) return null;
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    cargo: u.cargo,
    pessoa_id: u.pessoa_id,
    trocar_senha: u.trocar_senha,
    papeis: u.papeis.map((p) => ({ papel: p.papel, municipio_id: p.municipio_id })),
  };
}

/**
 * Usuário da requisição atual (Server Components, Server Actions e Route Handlers).
 * Aceita cookie de acesso, cookie de refresh (renovação transparente) ou header Authorization: Bearer.
 */
export async function getUsuario(): Promise<UsuarioSessao | null> {
  const h = await headers();
  const bearer = h.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) {
    const sub = await verificarToken(bearer, "access");
    return sub ? carregarUsuario(sub) : null;
  }
  const c = await cookies();
  const sub = (await verificarToken(c.get(COOKIE_ACESSO)?.value, "access")) ?? (await verificarToken(c.get(COOKIE_REFRESH)?.value, "refresh"));
  return sub ? carregarUsuario(sub) : null;
}

/** Para páginas: exige login (redireciona) e, opcionalmente, perfil interno. */
export async function exigirUsuario(opts: { interno?: boolean } = {}): Promise<UsuarioSessao> {
  const u = await getUsuario();
  if (!u) redirect("/login");
  if (u.trocar_senha) redirect("/trocar-senha");
  if (opts.interno && !isInterno(u)) redirect("/meus-processos");
  return u;
}
