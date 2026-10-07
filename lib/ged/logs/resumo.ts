// Contadores baratos (escopados ao cliente) para a página inicial do GED – ex.: cartões de "Logs" para auditor/admin.
// Uso (frente A, app/(ged)/ged/page.tsx):  const r = await resumoLogs(ctx);  → null se o papel não vê logs.
import type { CtxGed } from "../escopo";
import { podeVerLogs } from "../papeis";

export type ResumoLogs = {
  acessos_24h: number;
  negados_24h: number;
  comunicacoes_pendentes: number;
  comunicacoes_com_erro_7d: number;
};

export async function resumoLogs(ctx: CtxGed, agora = new Date()): Promise<ResumoLogs | null> {
  if (!podeVerLogs(ctx)) return null;
  const h24 = new Date(agora.getTime() - 24 * 3600_000);
  const d7 = new Date(agora.getTime() - 7 * 86_400_000);
  const [acessos_24h, negados_24h, comunicacoes_pendentes, comunicacoes_com_erro_7d] = await Promise.all([
    ctx.db.gedAcessoLog.count({ where: { created_at: { gte: h24 } } }),
    ctx.db.gedAcessoLog.count({ where: { created_at: { gte: h24 }, acao: "NEGADO" } }),
    ctx.db.gedComunicacao.count({ where: { status: "PENDENTE" } }),
    ctx.db.gedComunicacao.count({ where: { status: "ERRO", created_at: { gte: d7 } } }),
  ]);
  return { acessos_24h, negados_24h, comunicacoes_pendentes, comunicacoes_com_erro_7d };
}
