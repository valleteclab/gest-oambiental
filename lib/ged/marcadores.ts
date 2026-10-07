// Marcadores (etiquetas coloridas) do cliente – item 4 do edital. Gestão: GED_ADMIN/GED_GESTOR (capacidade "marcadores").
// Aplicar/remover em um documento: ação EDITAR no documento. Nome único sem diferenciar maiúsculas (índice no banco + pré-checagem).
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { invalido, proibido } from "@/lib/http";
import { auditarGed } from "./auditoria";
import { exigirEncontrado } from "./db";
import type { CtxGed } from "./escopo";
import { podeGed } from "./papeis";
import { exigirDocumento } from "./permissoes";
import { zUuid } from "./tipos";

export const COR_MARCADOR_PADRAO = "#0f766e";
export const zMarcador = z.object({
  nome: z.string().trim().min(1, "Informe o nome do marcador.").max(60, "Nome com até 60 caracteres."),
  cor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use o formato #RRGGBB).").default(COR_MARCADOR_PADRAO),
});
export type EntradaMarcador = z.infer<typeof zMarcador>;

export type MarcadorView = { id: string; nome: string; cor: string };
export type MarcadorAdminView = MarcadorView & { usos: number };

const ehUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const exigirGestao = (ctx: CtxGed) => {
  if (!podeGed(ctx, "marcadores")) throw proibido("Somente administradores e gestores podem gerenciar marcadores.");
};
const ordenar = <T extends { nome: string }>(l: T[]) => l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

/** Todos os marcadores do cliente (qualquer membro lê: servem de filtro e de seletor). */
export async function listarMarcadores(ctx: CtxGed): Promise<MarcadorView[]> {
  return ordenar(await ctx.db.gedMarcador.findMany({ select: { id: true, nome: true, cor: true } }));
}

/** Para a tela de administração: inclui quantos documentos usam cada marcador. */
export async function listarMarcadoresAdmin(ctx: CtxGed): Promise<MarcadorAdminView[]> {
  exigirGestao(ctx);
  const [marcadores, usos] = await Promise.all([
    listarMarcadores(ctx),
    ctx.db.gedDocumentoMarcador.groupBy({ by: ["marcador_id"], _count: { _all: true } }),
  ]);
  const m = new Map(usos.map((u) => [u.marcador_id, u._count._all]));
  return marcadores.map((x) => ({ ...x, usos: m.get(x.id) ?? 0 }));
}

async function exigirNomeLivre(ctx: CtxGed, nome: string, ignorarId?: string) {
  const igual = await ctx.db.gedMarcador.findFirst({ where: { nome: { equals: nome, mode: "insensitive" }, ...(ignorarId ? { id: { not: ignorarId } } : {}) }, select: { id: true } });
  if (igual) throw invalido(`Já existe um marcador chamado "${nome}".`);
}

export async function criarMarcador(ctx: CtxGed, entrada: unknown): Promise<{ id: string }> {
  exigirGestao(ctx);
  const e = zMarcador.parse(entrada);
  await exigirNomeLivre(ctx, e.nome);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const m = await tx.gedMarcador.create({ data: { nome: e.nome, cor: e.cor.toLowerCase() } as Prisma.GedMarcadorUncheckedCreateInput });
      await auditarGed(ctx, { acao: "GED_MARCADOR_CRIADO", entidade: "ged_marcador", entidade_id: m.id, depois: { nome: m.nome, cor: m.cor } }, tx);
      return { id: m.id };
    });
  } catch (err) {
    if (ehUnico(err)) throw invalido(`Já existe um marcador chamado "${e.nome}".`);
    throw err;
  }
}

export async function atualizarMarcador(ctx: CtxGed, id: string, entrada: unknown): Promise<void> {
  exigirGestao(ctx);
  const marcadorId = zUuid.parse(id);
  const e = zMarcador.parse(entrada);
  const antes = exigirEncontrado(await ctx.db.gedMarcador.findUnique({ where: { id: marcadorId } }), "Marcador não encontrado.");
  await exigirNomeLivre(ctx, e.nome, marcadorId);
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.gedMarcador.update({ where: { id: marcadorId }, data: { nome: e.nome, cor: e.cor.toLowerCase() } });
      await auditarGed(ctx, { acao: "GED_MARCADOR_ATUALIZADO", entidade: "ged_marcador", entidade_id: marcadorId, antes: { nome: antes.nome, cor: antes.cor }, depois: { nome: e.nome, cor: e.cor.toLowerCase() } }, tx);
    });
  } catch (err) {
    if (ehUnico(err)) throw invalido(`Já existe um marcador chamado "${e.nome}".`);
    throw err;
  }
}

/** Exclui o marcador e o remove dos documentos (auditado com a contagem). */
export async function excluirMarcador(ctx: CtxGed, id: string): Promise<void> {
  exigirGestao(ctx);
  const marcadorId = zUuid.parse(id);
  const antes = exigirEncontrado(await ctx.db.gedMarcador.findUnique({ where: { id: marcadorId } }), "Marcador não encontrado.");
  await ctx.db.$transaction(async (tx) => {
    const r = await tx.gedDocumentoMarcador.deleteMany({ where: { marcador_id: marcadorId } });
    await tx.gedMarcador.delete({ where: { id: marcadorId } });
    await auditarGed(ctx, { acao: "GED_MARCADOR_EXCLUIDO", entidade: "ged_marcador", entidade_id: marcadorId, antes: { nome: antes.nome, cor: antes.cor }, depois: { documentos_desvinculados: r.count } }, tx);
  });
}

/** Marcadores de um documento (o chamador já verificou VER). */
export async function marcadoresDoDocumento(ctx: CtxGed, documentoId: string): Promise<MarcadorView[]> {
  const l = await ctx.db.gedDocumentoMarcador.findMany({ where: { documento_id: documentoId }, select: { marcador: { select: { id: true, nome: true, cor: true } } } });
  return ordenar(l.map((x) => x.marcador));
}

/** Define o conjunto de marcadores do documento (exige EDITAR). Ids de outro cliente são recusados. */
export async function definirMarcadoresDocumento(ctx: CtxGed, documentoId: string, marcadorIds: string[]): Promise<{ adicionados: number; removidos: number }> {
  const ids = [...new Set(z.array(zUuid).max(30, "No máximo 30 marcadores.").parse(marcadorIds))];
  await exigirDocumento(ctx, documentoId, "EDITAR");
  const validos = ids.length ? await ctx.db.gedMarcador.findMany({ where: { id: { in: ids } }, select: { id: true } }) : [];
  if (validos.length !== ids.length) throw invalido("Marcador não encontrado.");
  return ctx.db.$transaction(async (tx) => {
    const atuais = (await tx.gedDocumentoMarcador.findMany({ where: { documento_id: documentoId }, select: { marcador_id: true } })).map((x) => x.marcador_id);
    const novos = ids.filter((i) => !atuais.includes(i));
    const fora = atuais.filter((i) => !ids.includes(i));
    if (novos.length) await tx.gedDocumentoMarcador.createMany({ data: novos.map((marcador_id) => ({ documento_id: documentoId, marcador_id })) as Prisma.GedDocumentoMarcadorCreateManyInput[] });
    if (fora.length) await tx.gedDocumentoMarcador.deleteMany({ where: { documento_id: documentoId, marcador_id: { in: fora } } });
    if (novos.length || fora.length) {
      await auditarGed(ctx, { acao: "GED_DOCUMENTO_MARCADORES", entidade: "ged_documento", entidade_id: documentoId, antes: { marcadores: atuais }, depois: { marcadores: ids } }, tx);
    }
    return { adicionados: novos.length, removidos: fora.length };
  });
}
