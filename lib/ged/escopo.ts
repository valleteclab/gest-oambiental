// Contexto GED da requisição: quem é o usuário, em qual cliente (organização/tenant), com qual papel no GED,
// em quais setores, e o cliente de banco JÁ ESCOPADO (`ctx.db`).
//
//   Páginas/layouts ........ const ctx = await exigirGed();            (redireciona/403; memoizado por requisição)
//   Route handlers ......... const ctx = await ctxGedApi();             (lança ErroApi 401/403; use dentro de rota())
//   Server actions ......... const ctx = await ctxGedApi();             (checa de novo; nunca confie no front)
//   Jobs/scripts/testes .... const r = await ctxGedDeUsuario(usuario)  (sem next/headers)
//
// Exige: sessão válida, usuário com organização, módulo GED ativo na organização e GedMembro ativo.
// Usuário só de licenciamento (sem GedMembro) é recusado; usuário só de GED (organizacao_id + zero UsuarioPapel) funciona.
import "server-only";
import { cache } from "react";
import { forbidden } from "next/navigation";
import { exigirUsuario, getUsuario } from "@/lib/auth";
import { naoAutenticado, proibido } from "@/lib/http";
import type { UsuarioSessao } from "@/lib/rbac";
import { sessaoPorId } from "@/lib/sessao";
import type { GedPapel } from "@prisma/client";
import { gedDb, type GedDb } from "./db";

export type CtxGed = {
  usuario: UsuarioSessao;
  organizacao_id: string;
  membro: { id: string; papel: GedPapel };
  /** Setores ATIVOS dos quais o usuário participa (base das permissões por setor). */
  setor_ids: string[];
  /** Cliente Prisma escopado à organização (use `ctx.db.$transaction(async (tx) => …)` – o escopo vale em `tx`). */
  db: GedDb;
  /** Dados do cliente para cabeçalhos/telas. */
  organizacao: { id: string; nome: string; sigla: string; logo_url: string | null };
};

export type MotivoSemGed = "SEM_ORGANIZACAO" | "MODULO_INATIVO" | "SEM_MEMBRO";
export type ResultadoCtxGed = { ok: true; ctx: CtxGed } | { ok: false; motivo: MotivoSemGed };

const MENSAGEM_MOTIVO: Record<MotivoSemGed, string> = {
  SEM_ORGANIZACAO: "Seu usuário não pertence a uma organização com o módulo Gestão de Documentos.",
  MODULO_INATIVO: "O módulo Gestão de Documentos não está contratado para esta organização.",
  SEM_MEMBRO: "Seu usuário não tem acesso ao módulo Gestão de Documentos.",
};

/**
 * Monta o contexto GED de um usuário já autenticado (sem depender de requisição – serve a jobs, seeds e testes).
 * Nunca lança por falta de acesso: devolve `{ ok:false, motivo }`.
 */
export async function ctxGedDeUsuario(usuario: UsuarioSessao): Promise<ResultadoCtxGed> {
  const orgId = usuario.organizacao_id;
  if (!orgId) return { ok: false, motivo: "SEM_ORGANIZACAO" };
  const db = gedDb(orgId);
  const org = await db.organizacao.findUnique({ where: { id: orgId }, select: { id: true, nome: true, sigla: true, logo_url: true, modulos: true, status: true } });
  if (!org || org.status !== "ATIVO" || !org.modulos.includes("GED")) return { ok: false, motivo: "MODULO_INATIVO" };
  const membro = await db.gedMembro.findFirst({ where: { usuario_id: usuario.id, ativo: true }, select: { id: true, papel: true } });
  if (!membro) return { ok: false, motivo: "SEM_MEMBRO" };
  const setores = await db.gedSetorMembro.findMany({ where: { usuario_id: usuario.id, setor: { ativo: true } }, select: { setor_id: true } });
  return {
    ok: true,
    ctx: {
      usuario,
      organizacao_id: orgId,
      membro,
      setor_ids: setores.map((s) => s.setor_id),
      db,
      organizacao: { id: org.id, nome: org.nome, sigla: org.sigla, logo_url: org.logo_url },
    },
  };
}

/** Conveniência para jobs: contexto pelo id do usuário (null se inativo/sem acesso ao GED). */
export async function ctxGedPorUsuarioId(usuarioId: string): Promise<CtxGed | null> {
  const u = await sessaoPorId(usuarioId);
  if (!u) return null;
  const r = await ctxGedDeUsuario(u);
  return r.ok ? r.ctx : null;
}

/**
 * Para PÁGINAS e LAYOUTS (Server Components): sem sessão → /login; troca de senha pendente → /trocar-senha;
 * sem módulo/membro → 403 (app/forbidden.tsx). Memoizado por requisição (layout + página não repetem consultas).
 */
export const exigirGed = cache(async (): Promise<CtxGed> => {
  const usuario = await exigirUsuario();
  const r = await ctxGedDeUsuario(usuario);
  if (!r.ok) forbidden();
  return r.ctx;
});

/**
 * Para ROUTE HANDLERS e SERVER ACTIONS: devolve o contexto ou lança ErroApi (401 sem sessão, 403 sem acesso ao GED),
 * no formato {code,message,details} de lib/http.ts (use dentro de `rota()`).
 */
export async function ctxGedApi(): Promise<CtxGed> {
  const usuario = await getUsuario();
  if (!usuario) throw naoAutenticado();
  if (usuario.trocar_senha) throw proibido("Troque a senha provisória antes de continuar.");
  const r = await ctxGedDeUsuario(usuario);
  if (!r.ok) throw proibido(MENSAGEM_MOTIVO[r.motivo]);
  return r.ctx;
}

/** Usado no login/redirecionamentos: o usuário tem GED ativo? (sem montar o contexto completo) */
export async function usuarioTemGed(usuarioId: string, organizacaoId: string | null): Promise<boolean> {
  if (!organizacaoId) return false;
  const db = gedDb(organizacaoId);
  const org = await db.organizacao.findUnique({ where: { id: organizacaoId }, select: { modulos: true, status: true } });
  if (org?.status !== "ATIVO" || !org.modulos.includes("GED")) return false;
  return (await db.gedMembro.count({ where: { usuario_id: usuarioId, ativo: true } })) > 0;
}
