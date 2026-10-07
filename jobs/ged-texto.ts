// GED – extração de texto dos PDFs (fila `ged-extrair-texto`). Worker: `registrar(boss, ctx)` é chamado por jobs/ged.ts.
//   - varredura a cada ~15 s (JOBS_GED_TEXTO_MS) enfileira as versões com texto_status=PENDENTE de TODOS os clientes
//     (lib/ged/documentos/extracao.ts descobre as organizações e consulta cada uma com gedDb(organizacao_id));
//   - o job processa cada versão com o escopo da SUA organização (organizacao_id vai no payload e é conferido no banco).
import type { BossGed, CtxJobsGed } from "./ged";

export const FILA_GED_TEXTO = "ged-extrair-texto";

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const { extrairTextoAgora, versoesPendentes } = await import("../lib/ged/documentos/extracao");
  await boss.createQueue(FILA_GED_TEXTO, { expireInSeconds: 600, retryLimit: 0 }).catch(() => {});

  await boss.work<{ id: string; organizacao_id: string }>(FILA_GED_TEXTO, { batchSize: 2 }, async (jobs) => {
    for (const j of jobs) {
      const r = await extrairTextoAgora(j.data.organizacao_id, j.data.id);
      ctx.log("ged-texto", j.data.id, r);
    }
  });

  const varrer = async () => {
    try {
      for (const v of await versoesPendentes(50)) {
        await boss.send(FILA_GED_TEXTO, { id: v.id, organizacao_id: v.organizacao_id }, { singletonKey: v.id });
      }
    } catch (e) {
      console.error("[jobs] varredura ged-texto", e);
    }
  };
  const t = setInterval(varrer, Number(process.env.JOBS_GED_TEXTO_MS ?? 15000));
  t.unref?.();
  void varrer();
}
