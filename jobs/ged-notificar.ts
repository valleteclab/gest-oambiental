// GED – envio das notificações da caixa de saída (fila `ged-notificar`) e retenção do log de acesso (fila `ged-retencao-logs`).
//
//  Varredura (a cada ~10 s, GED_NOTIFICAR_VARREDURA_MS): descobre as comunicações PENDENTES de TODOS os clientes
//  (comunicacoesPendentesEntreClientes devolve só ids) e enfileira um job por linha; o handler processa cada uma com
//  gedDb(organizacao_id). Falha de um cliente/linha não bloqueia as demais. A reserva atômica da linha (enviar.ts) evita
//  envio duplicado entre workers; retentativas com espera crescente ficam na própria linha ([tN] em `erro`).
import type { BossGed, CtxJobsGed } from "./ged";

type DadosJob = { organizacao_id: string; id: string };

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const { comunicacoesPendentesEntreClientes, organizacoesGedAtivas } = await import("../lib/ged/db");
  const { processarComunicacao } = await import("../lib/ged/notificar/enviar");
  const { aplicarRetencaoAcessoLog } = await import("../lib/ged/logs/retencao");

  await boss.createQueue("ged-notificar", { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 300 }).catch(() => {});
  await boss.createQueue("ged-retencao-logs", { retryLimit: 1, expireInSeconds: 3600 }).catch(() => {});
  await boss.schedule("ged-retencao-logs", process.env.JOBS_CRON_GED_RETENCAO ?? "40 3 * * *", null, { tz: ctx.tz });

  await boss.work<DadosJob>("ged-notificar", { batchSize: Number(process.env.GED_NOTIFICAR_LOTE ?? 5) }, async (jobs) => {
    const r = await Promise.allSettled(jobs.map((j) => processarComunicacao(j.data.organizacao_id, j.data.id)));
    r.forEach((x, i) => {
      if (x.status === "rejected") ctx.log("ged-notificar", jobs[i].data.id, "falhou:", x.reason instanceof Error ? x.reason.message : x.reason);
    });
    // Falhas inesperadas (infra) voltam ao pg-boss para retentativa; falha de envio já é estado da linha.
    const falhou = r.filter((x) => x.status === "rejected");
    if (falhou.length === r.length && falhou.length > 0) throw new Error("ged-notificar: todos os envios do lote falharam por erro de infraestrutura");
  });

  await boss.work("ged-retencao-logs", async () => {
    let apagados = 0;
    for (const org of await organizacoesGedAtivas()) {
      try {
        apagados += await aplicarRetencaoAcessoLog(org);
      } catch (e) {
        ctx.log("ged-retencao-logs", org, "falhou:", e instanceof Error ? e.message : e); // um cliente não impede os demais
      }
    }
    ctx.log("ged-retencao-logs", JSON.stringify({ apagados }));
    return { apagados };
  });

  const varrer = async () => {
    try {
      const linhas = await comunicacoesPendentesEntreClientes({ limite: Number(process.env.GED_NOTIFICAR_VARREDURA_LIMITE ?? 100), atualizadasAntesDe: new Date(Date.now() - 5000) });
      for (const l of linhas) await boss.send("ged-notificar", { organizacao_id: l.organizacao_id, id: l.id } satisfies DadosJob, { singletonKey: l.id, retryLimit: 3, retryDelay: 30, retryBackoff: true });
    } catch (e) {
      console.error("[jobs] varredura ged-notificar", e);
    }
  };
  const timer = setInterval(varrer, Number(process.env.GED_NOTIFICAR_VARREDURA_MS ?? 10000));
  timer.unref?.();
  ctx.log("ged-notificar: varredura da caixa de saída ativa; ged-retencao-logs agendado.");
}
