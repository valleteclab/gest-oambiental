// Worker de jobs em segundo plano (pg-boss sobre o próprio PostgreSQL). Rodar com `npm run jobs`.
//   alertas        – a cada 1 h (SPEC 6.1): gerarAlertas() (+ arquivamento automático, se configurado)
//   backup-check   – diário 07:10 (America/Bahia): avisa ADMIN por e-mail se o último backup tem > 24 h
//                    ou o último teste de restauração tem > 31 dias (SPEC 9.2)
//   exportacao     – fila das exportações completas (SPEC 9.2); a varredura a cada 10 s enfileira as PENDENTES
//
// O web detecta o worker pelo application_name das conexões (pg_stat_activity) e, sem worker,
// processa a exportação em segundo plano no próprio processo Next.
import Module from "node:module";
import path from "node:path";

// Os módulos de lib/ importam "server-only" (marcador do Next). Fora do Next ele lança erro,
// então o redirecionamos para o stub vazio do próprio pacote.
{
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return path.resolve(__dirname, "../node_modules/server-only/empty.js");
    return original.call(this, req, ...rest);
  };
}

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  /* variáveis já no ambiente */
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[jobs]", ...a);

async function main() {
  const { PgBoss } = await import("pg-boss");
  const { gerarAlertas } = await import("../lib/alertas/gerar");
  const { processarExportacao, exportacoesPendentes, NOME_APLICACAO_WORKER } = await import("../lib/export/exportar");
  const { verificarBackup } = await import("./backup-check");
  const { prisma } = await import("../lib/db");

  const url = (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "");
  if (!url) throw new Error("DATABASE_URL não definida");
  const tz = process.env.JOBS_TZ ?? "America/Bahia";

  const boss = new PgBoss({ connectionString: url, schema: "pgboss", application_name: NOME_APLICACAO_WORKER });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();

  for (const q of ["alertas", "backup-check", "exportacao"]) await boss.createQueue(q).catch(() => {});

  await boss.schedule("alertas", process.env.JOBS_CRON_ALERTAS ?? "0 * * * *", null, { tz });
  await boss.schedule("backup-check", process.env.JOBS_CRON_BACKUP ?? "10 7 * * *", null, { tz });

  await boss.work("alertas", async () => {
    const r = await gerarAlertas();
    log("alertas", JSON.stringify(r));
    return r;
  });

  await boss.work("backup-check", async () => {
    const r = await verificarBackup();
    log("backup-check", JSON.stringify(r));
    return r;
  });

  await boss.work<{ id: string }>("exportacao", async (jobs) => {
    for (const j of jobs) {
      log("exportacao", j.data.id, "iniciada");
      await processarExportacao(j.data.id);
      log("exportacao", j.data.id, "concluída");
    }
  });

  // Varredura: exportações PENDENTES (solicitadas pelo web) → fila `exportacao`
  const varrer = async () => {
    try {
      for (const id of await exportacoesPendentes()) await boss.send("exportacao", { id }, { singletonKey: id, retryLimit: 1 });
    } catch (e) {
      console.error("[jobs] varredura exportação", e);
    }
  };
  const timer = setInterval(varrer, Number(process.env.JOBS_VARREDURA_MS ?? 10000));
  await varrer();

  // Primeira rodada de alertas na subida (idempotente)
  if (process.env.JOBS_ALERTAS_NA_SUBIDA !== "false") await boss.send("alertas", null, { singletonKey: "subida" });

  log(`worker no ar (fuso ${tz}). Filas: alertas (1 h), backup-check (diário), exportacao.`);

  const parar = async () => {
    log("encerrando…");
    clearInterval(timer);
    await boss.stop({ graceful: true, timeout: 30000 }).catch(() => {});
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);
}

main().catch((e) => {
  console.error("[jobs] falha ao iniciar", e);
  process.exit(1);
});
