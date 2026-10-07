// GED – exclusão controlada em segundo plano (fila `ged-excluir`). Worker: `registrar(boss, ctx)` é chamado por jobs/ged.ts.
//   - varredura a cada ~10 s (JOBS_GED_EXCLUIR_MS) enfileira as exclusões PENDENTE (ou PROCESSANDO sem sinal de vida) de TODOS os clientes;
//   - o job processa com o escopo da SUA organização (organizacao_id vai no payload e é conferido no banco);
//   - retomável: a cada início reavalia o que ainda existe; documentos em blocos (uma transação por bloco), pastas vazias depois e,
//     por último, os arquivos do storage (lib/ged/exclusao/servico.ts). Nenhuma trava de imutabilidade é desligada.
import type { BossGed, CtxJobsGed } from "./ged";

export const FILA_GED_EXCLUIR = "ged-excluir";

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const { executarExclusao, exclusoesPendentes } = await import("../lib/ged/exclusao/servico");
  await boss.createQueue(FILA_GED_EXCLUIR, { expireInSeconds: 6 * 3600, retryLimit: 0 }).catch(() => {});

  await boss.work<{ id: string; organizacao_id: string }>(FILA_GED_EXCLUIR, { batchSize: 1 }, async (jobs) => {
    for (const j of jobs) {
      const r = await executarExclusao(j.data.organizacao_id, j.data.id);
      ctx.log("ged-excluir", j.data.id, r);
    }
  });

  const varrer = async () => {
    try {
      for (const e of await exclusoesPendentes(10)) {
        await boss.send(FILA_GED_EXCLUIR, { id: e.id, organizacao_id: e.organizacao_id }, { singletonKey: e.id });
      }
    } catch (e) {
      console.error("[jobs] varredura ged-excluir", e);
    }
  };
  const t = setInterval(varrer, Number(process.env.JOBS_GED_EXCLUIR_MS ?? 10000));
  t.unref?.();
  void varrer();
}
