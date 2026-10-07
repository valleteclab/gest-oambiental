import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { COOKIE_ACESSO, COOKIE_REFRESH, verificarSenha, verificarToken } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { ipBloqueado, ipDaRequisicao, registrarFalhaIp, MENSAGEM_MUITAS_TENTATIVAS } from "@/lib/limite-login";
import { motivoInelegivelOperador } from "./regras";

// IDENTIDADE DO OPERADOR DA PLATAFORMA (docs/plataforma.md – modelo de ameaça).
//
// Operador = linha ATIVA em operador_plataforma ligada a um Usuario SEM organização, SEM papéis, SEM pessoa e SEM GED.
// Essa linha só é criada pela CLI (`npm run plataforma:operador`) ou pelo bootstrap PLATAFORMA_OPERADORES (predeploy) –
// nenhuma tela ou API de cliente grava a tabela. Toda página, Server Action e rota de /plataforma chama estas funções
// (nunca só o menu): quem não é operador recebe 404 (notFound), indistinguível de uma rota que não existe.
//
//  - Sessão: login normal (cookies lg_access/lg_refresh, NUNCA o header Bearer – tokens de API não valem aqui).
//  - Reautenticação: /plataforma exige a senha de novo (cookie lg_plat, JWT próprio, 15 min, Strict, path /plataforma).
//  - Limite: falhas de reautenticação por IP e por operador; ações por operador por janela.

export const COOKIE_PLATAFORMA = "lg_plat";
export const REAUTH_SEG = 15 * 60;
const LIMITE_ACOES = 60; // por operador, por janela de 5 min
const JANELA_ACOES_MS = 5 * 60_000;
const LIMITE_REAUTH_USUARIO = 5; // falhas por operador em 15 min
const JANELA_REAUTH_MS = 15 * 60_000;

const segredo = () => new TextEncoder().encode(`plataforma:${process.env.AUTH_SECRET ?? "dev-secret"}`);

export type Operador = { id: string; nome: string; email: string };

/** Id do usuário da sessão por COOKIE (sem Bearer), ou null. */
async function usuarioIdDaSessaoCookie(): Promise<string | null> {
  const c = await cookies();
  return (await verificarToken(c.get(COOKIE_ACESSO)?.value, "access")) ?? (await verificarToken(c.get(COOKIE_REFRESH)?.value, "refresh"));
}

/**
 * Operador da requisição atual (cookie de sessão + linha ativa em operador_plataforma + elegibilidade reconferida
 * no banco a cada chamada). null para qualquer outra pessoa (inclusive admin de cliente e requerente).
 */
export async function obterOperador(): Promise<(Operador & { trocar_senha: boolean }) | null> {
  const id = await usuarioIdDaSessaoCookie();
  if (!id) return null;
  const u = await prisma.usuario
    .findUnique({
      where: { id },
      select: {
        id: true, nome: true, email: true, ativo: true, organizacao_id: true, pessoa_id: true, trocar_senha: true,
        operador: { select: { ativo: true } },
        _count: { select: { papeis: true, ged_membros: true } },
      },
    })
    .catch(() => null);
  if (!u || !u.operador?.ativo) return null;
  if (motivoInelegivelOperador({ ativo: u.ativo, organizacao_id: u.organizacao_id, pessoa_id: u.pessoa_id, papeis: u._count.papeis, ged_membros: u._count.ged_membros })) return null;
  return { id: u.id, nome: u.nome, email: u.email, trocar_senha: u.trocar_senha };
}

/** Linha ativa em operador_plataforma para o usuário (redirecionamento pós-login e link do menu – NÃO é a verificação de segurança). */
export async function usuarioEhOperador(usuarioId: string): Promise<boolean> {
  return (await prisma.operadorPlataforma.count({ where: { usuario_id: usuarioId, ativo: true } })) > 0;
}

/** É operador? (para o link discreto do menu – NUNCA é a verificação de segurança das páginas/ações). */
export async function ehOperadorDaSessao(): Promise<boolean> {
  return !!(await obterOperador());
}

const ultimoNegado = new Map<string, number>();
/** Registra (no máximo 1×/min por usuário) a tentativa de um usuário logado que NÃO é operador. */
async function registrarAcessoNegado(usuarioId: string) {
  const agora = Date.now();
  if (agora - (ultimoNegado.get(usuarioId) ?? 0) < 60_000) return;
  ultimoNegado.set(usuarioId, agora);
  if (ultimoNegado.size > 5000) ultimoNegado.clear();
  await auditar({ usuario_id: usuarioId, acao: "PLATAFORMA_ACESSO_NEGADO", entidade: "plataforma" }).catch(() => {});
}

/**
 * Guarda de PÁGINAS e ACTIONS: operador autenticado ou 404. Chame no início de TODA página/action de /plataforma.
 * (A reautenticação é tratada por `exigirOperadorReautenticado`.)
 */
export async function exigirOperador(): Promise<Operador> {
  const op = await obterOperador();
  if (!op) {
    const id = await usuarioIdDaSessaoCookie();
    if (id) await registrarAcessoNegado(id);
    notFound();
  }
  if (op.trocar_senha) redirect("/trocar-senha"); // senha provisória: troca antes de qualquer coisa
  return { id: op.id, nome: op.nome, email: op.email };
}

async function reauthValida(operadorId: string): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_PLATAFORMA)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, segredo());
    return payload.typ === "plataforma" && payload.sub === operadorId;
  } catch {
    return false;
  }
}

/** Páginas: operador + situação da reautenticação (false → a página mostra só o formulário de senha). */
export async function operadorDaPagina(): Promise<{ operador: Operador; reautenticado: boolean }> {
  const operador = await exigirOperador();
  return { operador, reautenticado: await reauthValida(operador.id) };
}

export class ErroReautenticacao extends Error {
  constructor() {
    super("Sessão da plataforma expirada. Confirme sua senha novamente.");
  }
}

/** Server Actions: operador + reautenticação recente + limite de ações. Lança ErroReautenticacao (a action devolve a mensagem). */
export async function exigirOperadorAcao(): Promise<Operador> {
  const operador = await exigirOperador();
  if (!(await reauthValida(operador.id))) throw new ErroReautenticacao();
  const chave = `plat-acao:${operador.id}`;
  if (ipBloqueado(chave, Date.now(), LIMITE_ACOES, JANELA_ACOES_MS)) throw new Error("Muitas operações em pouco tempo. Aguarde alguns minutos.");
  registrarFalhaIp(chave, Date.now(), JANELA_ACOES_MS);
  await prisma.operadorPlataforma.update({ where: { usuario_id: operador.id }, data: { ultimo_acesso: new Date() } }).catch(() => {});
  return operador;
}

/** Confirma a senha do operador e abre a janela de 15 min. Falhas contam por IP e por operador. */
export async function reautenticar(senha: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const operador = await exigirOperador();
  const h = await headers();
  const ip = ipDaRequisicao(h);
  const chaveIp = `plat-reauth:${ip}`;
  const chaveUsuario = `plat-reauth-u:${operador.id}`;
  if (ipBloqueado(chaveIp, Date.now(), 10, JANELA_REAUTH_MS) || ipBloqueado(chaveUsuario, Date.now(), LIMITE_REAUTH_USUARIO, JANELA_REAUTH_MS)) {
    await auditar({ usuario_id: operador.id, acao: "PLATAFORMA_REAUTH_BLOQUEADA", entidade: "plataforma" }).catch(() => {});
    return { ok: false, erro: MENSAGEM_MUITAS_TENTATIVAS };
  }
  const reg = await prisma.usuario.findUnique({ where: { id: operador.id }, select: { senha_hash: true } });
  if (!reg || !(await verificarSenha(reg.senha_hash, senha))) {
    registrarFalhaIp(chaveIp, Date.now(), JANELA_REAUTH_MS);
    registrarFalhaIp(chaveUsuario, Date.now(), JANELA_REAUTH_MS);
    await auditar({ usuario_id: operador.id, acao: "PLATAFORMA_REAUTH_FALHA", entidade: "plataforma" }).catch(() => {});
    return { ok: false, erro: "Senha incorreta." };
  }
  const token = await new SignJWT({ typ: "plataforma" }).setProtectedHeader({ alg: "HS256" }).setSubject(operador.id).setIssuedAt().setExpirationTime(`${REAUTH_SEG}s`).sign(segredo());
  (await cookies()).set(COOKIE_PLATAFORMA, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/plataforma", maxAge: REAUTH_SEG });
  await prisma.operadorPlataforma.update({ where: { usuario_id: operador.id }, data: { ultimo_acesso: new Date() } }).catch(() => {});
  await auditar({ usuario_id: operador.id, acao: "PLATAFORMA_REAUTH", entidade: "plataforma" });
  return { ok: true };
}

export async function encerrarReautenticacao() {
  (await cookies()).delete({ name: COOKIE_PLATAFORMA, path: "/plataforma" });
}

/** Auditoria de uma ação do operador: ator = operador, cliente-alvo em `organizacao_id` (consultável por cliente). */
export async function auditarPlataforma(
  operador: Operador,
  e: { acao: string; organizacao_id?: string | null; entidade: string; entidade_id?: string | null; antes?: unknown; depois?: unknown },
  tx?: Parameters<typeof auditar>[1],
) {
  await auditar({ usuario_id: operador.id, acao: `PLATAFORMA_${e.acao}`, entidade: e.entidade, entidade_id: e.entidade_id ?? null, antes: e.antes, depois: e.depois, organizacao_id: e.organizacao_id ?? null }, tx);
}
