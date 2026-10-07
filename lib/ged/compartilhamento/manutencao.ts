// Manutenção diária/periódica do compartilhamento de UM cliente (job jobs/ged-compartilhamento.ts):
//   - links ATIVOS vencidos viram EXPIRADO (sessões abertas encerradas, evento registrado);
//   - OTPs vencidos há > 1 dia e sessões encerradas/vencidas há > 1 dia são APAGADOS (tokens de sessão e códigos não são retidos);
//   - eventos de links já encerrados (revogado/expirado) seguem a retenção do log de acesso do cliente (mínimo 90 dias).
import { gedDb } from "../db";
import { dataCorteRetencao, RETENCAO_PADRAO_DIAS } from "../logs/retencao";
import { dadosEvento } from "./eventos";

const LOTE = 2000;
export type ResultadoManutencao = { expirados: number; otps_apagados: number; sessoes_apagadas: number; eventos_apagados: number };

export async function manterCompartilhamentos(organizacaoId: string, agora = new Date()): Promise<ResultadoManutencao> {
  const db = gedDb(organizacaoId);
  const res: ResultadoManutencao = { expirados: 0, otps_apagados: 0, sessoes_apagadas: 0, eventos_apagados: 0 };

  const vencidos = await db.gedCompartilhamento.findMany({ where: { status: "ATIVO", expira_em: { lte: agora } }, select: { id: true }, take: LOTE });
  for (const l of vencidos) {
    const r = await db.gedCompartilhamento.updateMany({ where: { id: l.id, status: "ATIVO", expira_em: { lte: agora } }, data: { status: "EXPIRADO" } });
    if (r.count !== 1) continue;
    res.expirados++;
    await db.gedCompartilhamentoSessao.updateMany({ where: { compartilhamento_id: l.id, encerrada_em: null }, data: { encerrada_em: agora } });
    await db.gedCompartilhamentoEvento.create({ data: dadosEvento(organizacaoId, l.id, "EXPIRADO") }).catch(() => {});
  }

  const umDia = new Date(agora.getTime() - 86_400_000);
  res.otps_apagados = (await db.gedCompartilhamentoOtp.deleteMany({ where: { expira_em: { lt: umDia } } })).count;
  res.sessoes_apagadas = (await db.gedCompartilhamentoSessao.deleteMany({ where: { OR: [{ teto_em: { lt: umDia } }, { encerrada_em: { lt: umDia } }] } })).count;

  const cfg = await db.gedConfig.findFirst({ select: { retencao_acesso_log_dias: true } });
  const corte = dataCorteRetencao(cfg?.retencao_acesso_log_dias ?? RETENCAO_PADRAO_DIAS, agora);
  res.eventos_apagados = (await db.gedCompartilhamentoEvento.deleteMany({ where: { created_at: { lt: corte }, compartilhamento: { status: { not: "ATIVO" } } } })).count;
  return res;
}
