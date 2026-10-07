// Retenção do log de acesso: GedAcessoLog é a ÚNICA tabela de auditoria do GED que pode ser apagada (por prazo, em lotes).
// Prazo por cliente em GedConfig.retencao_acesso_log_dias (padrão 730). Chamado pelo job diário (jobs/ged-notificar.ts).
import { auditar } from "@/lib/audit";
import { gedDb } from "../db";

export const RETENCAO_PADRAO_DIAS = 730;
export const RETENCAO_MINIMA_DIAS = 90;
const LOTE = 5000;

/** Data de corte: registros ANTERIORES a ela podem ser apagados. Pura. */
export const dataCorteRetencao = (dias: number, agora = new Date()) => new Date(agora.getTime() - Math.max(dias, RETENCAO_MINIMA_DIAS) * 86_400_000);

/** Apaga, em lotes, os acessos mais antigos que a retenção do cliente. Devolve quantos apagou. */
export async function aplicarRetencaoAcessoLog(organizacaoId: string, opc: { agora?: Date; maxLotes?: number } = {}): Promise<number> {
  const db = gedDb(organizacaoId);
  const cfg = await db.gedConfig.findFirst({ select: { retencao_acesso_log_dias: true } });
  const corte = dataCorteRetencao(cfg?.retencao_acesso_log_dias ?? RETENCAO_PADRAO_DIAS, opc.agora);
  let total = 0;
  for (let i = 0; i < (opc.maxLotes ?? 200); i++) {
    const ids = await db.gedAcessoLog.findMany({ where: { created_at: { lt: corte } }, select: { id: true }, orderBy: { id: "asc" }, take: LOTE });
    if (!ids.length) break;
    const r = await db.gedAcessoLog.deleteMany({ where: { id: { in: ids.map((x) => x.id) }, created_at: { lt: corte } } });
    total += r.count;
    if (ids.length < LOTE) break;
  }
  if (total > 0) {
    await auditar({ usuario_id: null, organizacao_id: organizacaoId, acao: "GED_ACESSO_LOG_RETENCAO", entidade: "ged_acesso_log", depois: { apagados: total, anteriores_a: corte.toISOString() } });
  }
  return total;
}
