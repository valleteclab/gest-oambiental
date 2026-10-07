import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "./db";
import { registrarAuditoria } from "./audit";
import { isInterno, podeAcessarOrgao, type UsuarioSessao } from "./rbac";
import { sessaoPorId } from "./sessao";
import { MENSAGEM_CLIENTE_SUSPENSO } from "./plataforma/situacao";
import { ipBloqueado, ipDaRequisicao, MENSAGEM_MUITAS_TENTATIVAS, registrarFalhaIp } from "./limite-login";

// Sessão: JWT curto de acesso (15 min) + refresh (8 h), cookies Secure/HttpOnly/SameSite=Lax (SPEC 3 / 9.3).
export const COOKIE_ACESSO = "lg_access";
export const COOKIE_REFRESH = "lg_refresh";
/** Órgão (município) ativo da sessão – id do município; mesma duração do refresh. */
export const COOKIE_ORGAO = "lg_orgao";
/** Última sigla de órgão escolhida (pré-seleção do login); sobrevive ao logout. */
export const COOKIE_ORGAO_ULTIMO = "lg_orgao_ult";
const ULTIMO_ORGAO_SEG = 365 * 24 * 60 * 60;
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

export async function criarSessao(usuarioId: string, orgao?: OrgaoResumo | null) {
  const c = await cookies();
  c.set(COOKIE_ACESSO, await assinarToken(usuarioId, "access"), opcoesCookie(ACESSO_SEG));
  c.set(COOKIE_REFRESH, await assinarToken(usuarioId, "refresh"), opcoesCookie(REFRESH_SEG));
  if (orgao) await definirOrgaoAtivo(orgao);
}

/** Grava o órgão ativo (cookie httpOnly) e lembra a escolha para o próximo login. */
export async function definirOrgaoAtivo(orgao: OrgaoResumo) {
  const c = await cookies();
  c.set(COOKIE_ORGAO, orgao.id, opcoesCookie(REFRESH_SEG));
  c.set(COOKIE_ORGAO_ULTIMO, orgao.sigla, opcoesCookie(ULTIMO_ORGAO_SEG));
}

export async function encerrarSessao() {
  const c = await cookies();
  c.delete(COOKIE_ACESSO);
  c.delete(COOKIE_REFRESH);
  c.delete(COOKIE_ORGAO);
  c.delete({ name: "lg_plat", path: "/plataforma" }); // reautenticação do painel /plataforma (lib/plataforma/operador.ts)
}

// ───────────── Órgão (município) ativo ─────────────

export type OrgaoResumo = {
  id: string;
  sigla: string;
  nome: string;
  orgao_ambiental_nome: string;
  brasao_url: string | null;
  organizacao: { id: string; nome: string; sigla: string; logo_url: string | null };
};
const SELECT_ORGAO = {
  id: true, sigla: true, nome: true, orgao_ambiental_nome: true, brasao_url: true,
  organizacao: { select: { id: true, nome: true, sigla: true, logo_url: true } },
} as const;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Órgãos (municípios ativos) em ordem alfabética – de TODAS as organizações (lista pública: portal, login).
 * Para o que o usuário pode escolher, filtre com orgaosPermitidos(usuario, …) (ver /trocar-orgao).
 */
export async function listarOrgaos(): Promise<OrgaoResumo[]> {
  return prisma.municipio.findMany({ where: { ativo: true, organizacao: { status: "ATIVO", modulos: { has: "LICENCIAMENTO" } } }, select: SELECT_ORGAO, orderBy: { nome: "asc" } });
}

/** Resolve um órgão ativo pela sigla (ex.: "LOR") ou pelo id do município. */
export async function resolverOrgao(valor: string | null | undefined): Promise<OrgaoResumo | null> {
  const v = (valor ?? "").trim();
  if (!v) return null;
  const where = RE_UUID.test(v) ? { id: v } : { sigla: v.toUpperCase() };
  return prisma.municipio.findFirst({ where: { ...where, ativo: true, organizacao: { status: "ATIVO", modulos: { has: "LICENCIAMENTO" } } }, select: SELECT_ORGAO });
}

/** Sigla lembrada do último login (pré-seleção do /login). */
export async function ultimoOrgaoEscolhido(): Promise<string | null> {
  return (await cookies()).get(COOKIE_ORGAO_ULTIMO)?.value ?? null;
}

/**
 * Órgão ativo da sessão (cookie lg_orgao), validado contra os papéis atuais do usuário.
 * null quando não há sessão por cookie, órgão escolhido ou quando o usuário perdeu o acesso.
 */
export const getOrgaoAtivo = cache(async (): Promise<OrgaoResumo | null> => {
  const id = (await cookies()).get(COOKIE_ORGAO)?.value;
  if (!id || !RE_UUID.test(id)) return null;
  const u = await getUsuario();
  if (!u || !podeAcessarOrgao(u, id)) return null;
  return prisma.municipio.findFirst({ where: { id, ativo: true, organizacao: { status: "ATIVO", modulos: { has: "LICENCIAMENTO" } } }, select: SELECT_ORGAO });
});

export async function contextoRequisicao() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    user_agent: h.get("user-agent"),
  };
}

type ResultadoLogin = { ok: true; usuario: UsuarioSessao } | { ok: false; erro: string; motivo?: "orgao_sem_acesso" | "limite_ip" };

/** Chave do limite de falhas por IP (lib/limite-login.ts) da requisição atual. */
async function chaveIp(prefixo: string) {
  return `${prefixo}:${ipDaRequisicao(await headers())}`;
}

/** Limite por IP do /auth/refresh (true = bloqueado). Chame `falhaRefreshIp()` quando o token for inválido. */
export async function refreshBloqueadoPorIp(): Promise<boolean> {
  return ipBloqueado(await chaveIp("refresh"));
}
export async function falhaRefreshIp() {
  registrarFalhaIp(await chaveIp("refresh"));
}

export const ERRO_ORGAO_SEM_ACESSO = "Seu usuário não tem acesso a este órgão.";

/**
 * Autentica e-mail/senha. Se `orgao` (município já resolvido) for informado, valida também se o usuário
 * pode atuar nele (podeAcessarOrgao) – sem acesso → LOGIN_FALHA motivo orgao_sem_acesso.
 */
export async function autenticar(email: string, senha: string, orgao?: OrgaoResumo | null): Promise<ResultadoLogin> {
  const ctx = await contextoRequisicao();
  // Limite por IP (conta só falhas): barra força bruta distribuída entre várias contas a partir do mesmo IP.
  const ipChave = await chaveIp("login");
  if (ipBloqueado(ipChave)) {
    await registrarAuditoria({ usuario_id: null, acao: "LOGIN_BLOQUEADO_IP", entidade: "usuario", depois: { email }, ...ctx });
    return { ok: false, erro: MENSAGEM_MUITAS_TENTATIVAS, motivo: "limite_ip" };
  }
  const u = await prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
  const falha = async (motivo: string, usuarioId?: string) => {
    registrarFalhaIp(ipChave);
    await registrarAuditoria({ usuario_id: usuarioId ?? null, acao: "LOGIN_FALHA", entidade: "usuario", entidade_id: usuarioId ?? null, depois: { email, motivo }, ...ctx });
    return { ok: false as const, erro: "E-mail ou senha inválidos." };
  };
  if (!u) return falha("usuario_inexistente");
  if (!u.ativo) return falha("usuario_inativo", u.id);
  if (u.bloqueado_ate && u.bloqueado_ate > new Date()) {
    registrarFalhaIp(ipChave);
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
  const usuario = await carregarUsuario(u.id);
  if (!usuario) {
    // Cliente suspenso (painel /plataforma): só depois da senha correta, para não revelar a situação a quem não tem a conta.
    const suspensa = u.organizacao_id ? await prisma.organizacao.findFirst({ where: { id: u.organizacao_id, status: "SUSPENSO" }, select: { id: true } }) : null;
    if (suspensa) {
      await registrarAuditoria({ usuario_id: u.id, acao: "LOGIN_FALHA", entidade: "usuario", entidade_id: u.id, organizacao_id: u.organizacao_id, depois: { email, motivo: "cliente_suspenso" }, ...ctx });
      return { ok: false, erro: MENSAGEM_CLIENTE_SUSPENSO };
    }
    return { ok: false, erro: "Usuário inválido." };
  }
  if (orgao && !podeAcessarOrgao(usuario, orgao.id)) {
    await registrarAuditoria({ usuario_id: u.id, acao: "LOGIN_FALHA", entidade: "usuario", entidade_id: u.id, depois: { email, motivo: "orgao_sem_acesso", orgao: orgao.sigla }, ...ctx });
    return { ok: false, erro: ERRO_ORGAO_SEM_ACESSO, motivo: "orgao_sem_acesso" };
  }
  await prisma.usuario.update({ where: { id: u.id }, data: { falhas_login: 0, bloqueado_ate: null, ultimo_login: new Date() } });
  await registrarAuditoria({ usuario_id: u.id, acao: "LOGIN", entidade: "usuario", entidade_id: u.id, depois: orgao ? { orgao: orgao.sigla } : undefined, ...ctx });
  return { ok: true, usuario };
}

/**
 * Sessão do usuário: papéis + organização (tenant) e os ids de TODOS os municípios dessa organização
 * (`municipios_org`), para que lib/rbac.ts resolva o escopo de forma síncrona e nunca "vaze" para outra organização.
 */
export async function carregarUsuario(id: string): Promise<UsuarioSessao | null> {
  return sessaoPorId(id);
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
