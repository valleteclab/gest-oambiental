// Contadores e recentes baratos (escopados e filtrados por visibilidade) para a página inicial do GED.
// A página `app/(ged)/ged/page.tsx` (frente A) pode adotar: `const r = await resumoDocumentos(ctx)`.
import type { GedStatusDocumento } from "@prisma/client";
import type { CtxGed } from "../escopo";
import { whereGedVisivel } from "../permissoes";

export type ResumoDocumentos = {
  total: number;
  por_status: Partial<Record<GedStatusDocumento, number>>;
  /** Documentos visíveis cujo texto ainda está sendo indexado. */
  indexando: number;
  recentes: { id: string; numero: string; titulo: string; status: GedStatusDocumento; updated_at: Date }[];
};

export async function resumoDocumentos(ctx: CtxGed, recentes = 6): Promise<ResumoDocumentos> {
  const visiveis = { AND: [await whereGedVisivel(ctx, "VER"), { excluido_em: null }] };
  const [grupos, lista] = await Promise.all([
    ctx.db.gedDocumento.groupBy({ by: ["status"], where: visiveis, _count: { _all: true } }),
    ctx.db.gedDocumento.findMany({ where: { AND: [visiveis, { status: { not: "ARQUIVADO" } }] }, orderBy: [{ updated_at: "desc" }, { id: "asc" }], take: recentes, select: { id: true, numero: true, titulo: true, status: true, updated_at: true } }),
  ]);
  const por_status: ResumoDocumentos["por_status"] = {};
  let total = 0;
  for (const g of grupos) {
    por_status[g.status] = g._count._all;
    if (g.status !== "ARQUIVADO") total += g._count._all;
  }
  const indexando = await ctx.db.gedVersaoDocumento.count({ where: { texto_status: "PENDENTE", documento: { AND: [visiveis, { status: { not: "ARQUIVADO" } }] } } });
  return { total, por_status, indexando, recentes: lista };
}
