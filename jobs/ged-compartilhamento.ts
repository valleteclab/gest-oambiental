// GED – manutenção do compartilhamento externo (docs/ged.md §18): expira links vencidos e limpa OTPs/sessões antigos.
// Cron JOBS_CRON_GED_COMPARTILHAMENTO (padrão a cada 10 min). Cada cliente é processado com o escopo da SUA organização.
import type { BossGed, CtxJobsGed } from "./ged";

export const FILA_GED_COMPARTILHAMENTO = "ged-compartilhamento";

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const { organizacoesGedAtivas } = await import("../lib/ged/db");
  const { manterCompartilhamentos } = await import("../lib/ged/compartilhamento/manutencao");
  await boss.createQueue(FILA_GED_COMPARTILHAMENTO, { expireInSeconds: 1800, retryLimit: 1 }).catch(() => {});
  await boss.work(FILA_GED_COMPARTILHAMENTO, { batchSize: 1 }, async () => {
    for (const org of await organizacoesGedAtivas()) {
      try {
        const r = await manterCompartilhamentos(org);
        if (r.expirados || r.otps_apagados || r.sessoes_apagadas || r.eventos_apagados) ctx.log("ged-compartilhamento", org, r);
      } catch (e) {
        console.error("[jobs] ged-compartilhamento", org, e);
      }
    }
  });
  await boss.schedule(FILA_GED_COMPARTILHAMENTO, process.env.JOBS_CRON_GED_COMPARTILHAMENTO ?? "*/10 * * * *", null, { tz: ctx.tz });
}
