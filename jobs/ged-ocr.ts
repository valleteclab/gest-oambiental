// GED – OCR no servidor (fila `ged-ocr`; docs/ged-design.md §6, fase 2). Worker: `registrar(boss, ctx)` é chamado por jobs/ged.ts
// (ou, num worker dedicado, por jobs/worker.ts com JOBS_FILAS=ged-ocr).
//   - a varredura (JOBS_GED_OCR_MS, 20 s) enfileira as versões com ocr_status=PENDENTE de TODOS os clientes, com singletonKey = versão;
//   - o job processa UMA versão por vez com o escopo da SUA organização (organizacao_id no payload, conferido no banco);
//   - o OCR é pesado (CPU/memória): concorrência 1 por worker (ocrmypdf já usa --jobs 2); GED_OCR_DESATIVADO=true desliga neste worker.
import type { BossGed, CtxJobsGed } from "./ged";

export const FILA_GED_OCR = "ged-ocr";

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const { ocrAgora, versoesOcrPendentes } = await import("../lib/ged/ocr/servico");
  await boss.createQueue(FILA_GED_OCR, { policy: "short", expireInSeconds: 45 * 60, retryLimit: 0 }).catch(() => {});

  await boss.work<{ id: string; organizacao_id: string }>(FILA_GED_OCR, { batchSize: 1 }, async (jobs) => {
    for (const j of jobs) {
      const r = await ocrAgora(j.data.organizacao_id, j.data.id);
      ctx.log("ged-ocr", j.data.id, r);
    }
  });

  const varrer = async () => {
    try {
      for (const v of await versoesOcrPendentes(20)) {
        await boss.send(FILA_GED_OCR, { id: v.id, organizacao_id: v.organizacao_id }, { singletonKey: v.id });
      }
    } catch (e) {
      console.error("[jobs] varredura ged-ocr", e);
    }
  };
  const t = setInterval(varrer, Number(process.env.JOBS_GED_OCR_MS ?? 20000));
  t.unref?.();
  void varrer();
}
