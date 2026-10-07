// Tipos de documento do cliente (ofício, contrato, parecer…). Gestão: GED_ADMIN/GED_GESTOR (capacidade "tipos").
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { invalido, proibido } from "@/lib/http";
import { auditarGed } from "./auditoria";
import { exigirEncontrado } from "./db";
import type { CtxGed } from "./escopo";
import { podeGed } from "./papeis";
import { zUuid } from "./tipos";

export const zTipoDocumento = z.object({ nome: z.string().trim().min(2, "Informe o nome do tipo.").max(80, "Nome com até 80 caracteres.") });
export type TipoDocumentoView = { id: string; nome: string };
export type TipoDocumentoAdminView = TipoDocumentoView & { usos: number };

const ehUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const exigirGestao = (ctx: CtxGed) => {
  if (!podeGed(ctx, "tipos")) throw proibido("Somente administradores e gestores podem gerenciar tipos de documento.");
};

export async function listarTiposDocumento(ctx: CtxGed): Promise<TipoDocumentoView[]> {
  const l = await ctx.db.gedTipoDocumento.findMany({ select: { id: true, nome: true } });
  return l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

export async function listarTiposDocumentoAdmin(ctx: CtxGed): Promise<TipoDocumentoAdminView[]> {
  exigirGestao(ctx);
  const [tipos, usos] = await Promise.all([listarTiposDocumento(ctx), ctx.db.gedDocumento.groupBy({ by: ["tipo_id"], where: { tipo_id: { not: null } }, _count: { _all: true } })]);
  const m = new Map(usos.map((u) => [u.tipo_id, u._count._all]));
  return tipos.map((t) => ({ ...t, usos: m.get(t.id) ?? 0 }));
}

async function exigirNomeLivre(ctx: CtxGed, nome: string, ignorarId?: string) {
  const igual = await ctx.db.gedTipoDocumento.findFirst({ where: { nome: { equals: nome, mode: "insensitive" }, ...(ignorarId ? { id: { not: ignorarId } } : {}) }, select: { id: true } });
  if (igual) throw invalido(`Já existe o tipo "${nome}".`);
}

export async function criarTipoDocumento(ctx: CtxGed, entrada: unknown): Promise<{ id: string }> {
  exigirGestao(ctx);
  const e = zTipoDocumento.parse(entrada);
  await exigirNomeLivre(ctx, e.nome);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const t = await tx.gedTipoDocumento.create({ data: { nome: e.nome } as Prisma.GedTipoDocumentoUncheckedCreateInput });
      await auditarGed(ctx, { acao: "GED_TIPO_CRIADO", entidade: "ged_tipo_documento", entidade_id: t.id, depois: { nome: t.nome } }, tx);
      return { id: t.id };
    });
  } catch (err) {
    if (ehUnico(err)) throw invalido(`Já existe o tipo "${e.nome}".`);
    throw err;
  }
}

export async function atualizarTipoDocumento(ctx: CtxGed, id: string, entrada: unknown): Promise<void> {
  exigirGestao(ctx);
  const tipoId = zUuid.parse(id);
  const e = zTipoDocumento.parse(entrada);
  const antes = exigirEncontrado(await ctx.db.gedTipoDocumento.findUnique({ where: { id: tipoId } }), "Tipo não encontrado.");
  await exigirNomeLivre(ctx, e.nome, tipoId);
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.gedTipoDocumento.update({ where: { id: tipoId }, data: { nome: e.nome } });
      await auditarGed(ctx, { acao: "GED_TIPO_ATUALIZADO", entidade: "ged_tipo_documento", entidade_id: tipoId, antes: { nome: antes.nome }, depois: { nome: e.nome } }, tx);
    });
  } catch (err) {
    if (ehUnico(err)) throw invalido(`Já existe o tipo "${e.nome}".`);
    throw err;
  }
}

/** Exclui um tipo sem documentos (em uso: renomeie em vez de excluir). */
export async function excluirTipoDocumento(ctx: CtxGed, id: string): Promise<void> {
  exigirGestao(ctx);
  const tipoId = zUuid.parse(id);
  const antes = exigirEncontrado(await ctx.db.gedTipoDocumento.findUnique({ where: { id: tipoId } }), "Tipo não encontrado.");
  await ctx.db.$transaction(async (tx) => {
    const usos = await tx.gedDocumento.count({ where: { tipo_id: tipoId } });
    if (usos > 0) throw invalido("Este tipo está em uso por documentos. Renomeie-o em vez de excluir.");
    await tx.gedTipoDocumento.delete({ where: { id: tipoId } });
    await auditarGed(ctx, { acao: "GED_TIPO_EXCLUIDO", entidade: "ged_tipo_documento", entidade_id: tipoId, antes: { nome: antes.nome } }, tx);
  });
}
