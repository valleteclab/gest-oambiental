// GED – importação em lote de ZIP (fila `ged-importar`). Worker: `registrar(boss, ctx)` é chamado por jobs/ged.ts.
//   - varredura a cada ~10 s (JOBS_GED_IMPORTAR_MS) enfileira os lotes PENDENTE (ou PROCESSANDO sem sinal de vida) de TODOS os clientes;
//   - o job processa o lote com o escopo da SUA organização (organizacao_id vai no payload e é conferido no banco);
//   - o ZIP/partes/arquivos da pasta (ged/{org}/importacao/…) e o disco temporário são removidos ao fim (lib/ged/importacao/servico.ts);
//   - lotes RECEBENDO (envio nunca finalizado) há mais de 3 dias são descartados (a cada ~1 h).
import type { BossGed, CtxJobsGed } from "./ged";

export const FILA_GED_IMPORTAR = "ged-importar";

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const { executarImportacao, importacoesPendentes, limparImportacoesAbandonadas } = await import("../lib/ged/importacao/servico");
  await boss.createQueue(FILA_GED_IMPORTAR, { expireInSeconds: 6 * 3600, retryLimit: 0 }).catch(() => {});

  await boss.work<{ id: string; organizacao_id: string }>(FILA_GED_IMPORTAR, { batchSize: 1 }, async (jobs) => {
    for (const j of jobs) {
      const r = await executarImportacao(j.data.organizacao_id, j.data.id);
      ctx.log("ged-importar", j.data.id, r);
    }
  });

  let ultimaLimpeza = 0;
  const varrer = async () => {
    try {
      if (Date.now() - ultimaLimpeza > 3600_000) {
        ultimaLimpeza = Date.now();
        const n = await limparImportacoesAbandonadas();
        if (n > 0) ctx.log("ged-importar", "abandonados", { descartados: n });
      }
      for (const l of await importacoesPendentes(20)) {
        await boss.send(FILA_GED_IMPORTAR, { id: l.id, organizacao_id: l.organizacao_id }, { singletonKey: l.id });
      }
    } catch (e) {
      console.error("[jobs] varredura ged-importar", e);
    }
  };
  const t = setInterval(varrer, Number(process.env.JOBS_GED_IMPORTAR_MS ?? 10000));
  t.unref?.();
  void varrer();
}
