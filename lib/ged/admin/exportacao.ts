// Exportação completa dos dados DO CLIENTE (portabilidade): usa o serviço existente (lib/export) para a organização da sessão;
// histórico e download só das exportações desta organização (a rota /api/v1/admin/exportacoes exige papel de licenciamento,
// por isso o GED tem a sua em /api/v1/ged/admin/exportacao/[id]).
import { invalido } from "@/lib/http";
import { solicitarExportacao } from "@/lib/export/exportar";
import { lerArquivo } from "@/lib/storage";
import { auditarGed } from "../auditoria";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { exigirAdmin } from "./membros";

export type ExportacaoView = {
  id: string; status: "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "ERRO"; created_at: Date; concluida_em: Date | null; tamanho: number | null; erro: string | null; solicitada_por: string;
};

export async function listarExportacoes(ctx: CtxGed): Promise<ExportacaoView[]> {
  exigirAdmin(ctx);
  const l = await ctx.db.exportacao.findMany({ where: { organizacao_id: ctx.organizacao_id }, orderBy: { created_at: "desc" }, take: 50 });
  const nomes = new Map((await ctx.db.usuario.findMany({ where: { id: { in: [...new Set(l.map((e) => e.solicitada_por))] }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
  return l.map((e) => ({ id: e.id, status: e.status, created_at: e.created_at, concluida_em: e.concluida_em, tamanho: e.tamanho ?? null, erro: e.erro, solicitada_por: nomes.get(e.solicitada_por) ?? "—" }));
}

export async function solicitarExportacaoGed(ctx: CtxGed, origem: { ip?: string | null; user_agent?: string | null } = {}): Promise<{ id: string }> {
  exigirAdmin(ctx);
  const emAndamento = await ctx.db.exportacao.count({ where: { organizacao_id: ctx.organizacao_id, status: { in: ["PENDENTE", "PROCESSANDO"] } } });
  if (emAndamento > 0) throw invalido("Já existe uma exportação em andamento. Aguarde a conclusão.");
  const exp = await solicitarExportacao(ctx.usuario, "COMPLETA", origem); // sempre da organização de ctx.usuario
  await auditarGed(ctx, { acao: "GED_EXPORTACAO_SOLICITADA", entidade: "exportacao", entidade_id: exp.id, depois: { escopo: "COMPLETA" } });
  return { id: exp.id };
}

/** Bytes do ZIP de uma exportação CONCLUÍDA desta organização (404 para as demais). Audita o download. */
export async function baixarExportacao(ctx: CtxGed, id: string): Promise<{ nome: string; dados: Buffer }> {
  exigirAdmin(ctx);
  const e = exigirEncontrado(await ctx.db.exportacao.findFirst({ where: { id, organizacao_id: ctx.organizacao_id } }), "Exportação não encontrada.");
  if (e.status !== "CONCLUIDA" || !e.storage_key) throw invalido("A exportação ainda não foi concluída.");
  const dados = await lerArquivo(e.storage_key);
  await auditarGed(ctx, { acao: "GED_EXPORTACAO_DOWNLOAD", entidade: "exportacao", entidade_id: e.id, depois: { tamanho: dados.length } });
  return { nome: `exportacao-${ctx.organizacao.sigla.toLowerCase()}-${e.created_at.toISOString().slice(0, 10)}-${e.id.slice(0, 8)}.zip`, dados };
}
