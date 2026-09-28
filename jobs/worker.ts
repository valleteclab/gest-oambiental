// Worker de jobs em segundo plano (pg-boss sobre o próprio PostgreSQL). Rodar com `npm run jobs`.
//   alertas        – a cada 1 h (SPEC 6.1): gerarAlertas() (+ arquivamento automático, se configurado)
//   backup-check   – diário 07:10 (America/Bahia): avisa ADMIN por e-mail se o último backup tem > 24 h
//                    ou o último teste de restauração tem > 31 dias (SPEC 9.2)
//   exportacao     – fila das exportações completas (SPEC 9.2); a varredura a cada 10 s enfileira as PENDENTES
//   canal-mensagem / canais-manutencao – agente de denúncias (WhatsApp, chat do site, e-mail)
//   monitoramento-sync – diário 06:30 (America/Bahia): alertas de desmatamento DETER/PRODES por satélite (lib/monitoramento)
//   cobranca-sync – diário 07:00 (America/Bahia): situação das cobranças de taxas no Asaas (fallback do webhook – lib/cobranca)
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

  // ── Backup REAL (lib/backup/executar.ts – docs/backup.md) ──
  //   backup        diário (BACKUP_CRON, padrão 03:15): pg_dump -Fc | openssl AES-256 → bucket fora do provedor + retenção
  //   restore-test  mensal (BACKUP_RESTORE_CRON, padrão dia 1 às 04:45): restaura o último dump num banco descartável
  // Falhas são registradas em backup_registro e alertadas (BACKUP_ALERTA_EMAIL); sem retry automático.
  {
    const { executarBackup, executarTesteRestauracao } = await import("../lib/backup/executar");
    const { lerConfig } = await import("../lib/backup/nucleo");
    const cfgBackup = lerConfig();
    for (const q of ["backup", "restore-test"]) await boss.createQueue(q, { expireInSeconds: 6 * 3600, retryLimit: 0 }).catch(() => {});
    await boss.schedule("backup", cfgBackup.cronBackup, null, { tz });
    await boss.schedule("restore-test", cfgBackup.cronRestore, null, { tz });
    await boss.work("backup", async () => {
      const r = await executarBackup({ origem: "agendado (worker)" });
      log("backup", JSON.stringify(r));
      return r;
    });
    await boss.work("restore-test", async () => {
      const r = await executarTesteRestauracao({ origem: "agendado (worker)" });
      log("restore-test", JSON.stringify(r));
      return r;
    });
    log(`backup agendado: "${cfgBackup.cronBackup}", teste de restauração: "${cfgBackup.cronRestore}" (${tz}).`);
  }

  // ── Agente de denúncias (lib/agente – docs/agente-denuncias.md) ──
  //   canal-mensagem     – eventos de webhook (WhatsApp/e-mail) gravados pelo web; a varredura a cada 2 s enfileira os PENDENTES
  //   canais-manutencao  – a cada 15 min: reativa a IA após a pausa do atendente, encerra conversas inativas, retenção de eventos
  const agente = await (async () => {
    const { processarEvento, eventosPendentes } = await import("../lib/agente/ingestao");
    const { manutencaoCanais } = await import("../lib/agente/manutencao");
    for (const q of ["canal-mensagem", "canais-manutencao"]) await boss.createQueue(q).catch(() => {});
    await boss.schedule("canais-manutencao", process.env.JOBS_CRON_CANAIS ?? "*/15 * * * *", null, { tz });
    await boss.work<{ id: string }>("canal-mensagem", { batchSize: 5 }, async (jobs) => {
      await Promise.all(jobs.map((j) => processarEvento(j.data.id)));
    });
    await boss.work("canais-manutencao", async () => {
      const r = await manutencaoCanais();
      log("canais-manutencao", JSON.stringify(r));
      return r;
    });
    const varrerCanais = async () => {
      try {
        for (const id of await eventosPendentes()) await boss.send("canal-mensagem", { id }, { singletonKey: id, retryLimit: 2 });
      } catch (e) {
        console.error("[jobs] varredura canal-mensagem", e);
      }
    };
    return setInterval(varrerCanais, Number(process.env.JOBS_VARREDURA_CANAIS_MS ?? 2000));
  })();

  // ── Monitoramento por satélite (lib/monitoramento – docs/monitoramento.md) ──
  //   monitoramento-sync  diário (JOBS_CRON_MONITORAMENTO, padrão 06:30): DETER/PRODES (+ MapBiomas com token) de cada
  //                       município com código IBGE real, cruzamento com CAR/licenças e aviso no sino. Longo (rede): 4 h de validade.
  if (process.env.MONITORAMENTO_DESATIVADO !== "true") {
    const { sincronizarTodos } = await import("../lib/monitoramento/sync");
    await boss.createQueue("monitoramento-sync", { expireInSeconds: 4 * 3600, retryLimit: 1 }).catch(() => {});
    await boss.schedule("monitoramento-sync", process.env.JOBS_CRON_MONITORAMENTO ?? "30 6 * * *", null, { tz });
    await boss.work("monitoramento-sync", async () => {
      const r = await sincronizarTodos({ origem: "agendado" });
      log("monitoramento-sync", JSON.stringify(r.map((x) => ({ municipio: x.municipio, status: x.status, fontes: x.fontes.map((f) => `${f.fonte}:${f.status}:${f.recebidos}/${f.novos}`), cruzados: x.cruzados, notificados: x.notificados }))));
      return { municipios: r.length };
    });
  }

  // ── Cobrança de taxas (lib/cobranca – docs/cobranca.md) ──
  //   cobranca-sync  diário (JOBS_CRON_COBRANCA, padrão 07:00): fallback do webhook do Asaas – consulta as cobranças em
  //                  aberto (GET /payments/{id}), registra as que falharam no gateway e marca VENCIDA as vencidas.
  if (process.env.COBRANCA_SYNC_DESATIVADO !== "true") {
    const { sincronizarPendentes } = await import("../lib/cobranca/servico");
    await boss.createQueue("cobranca-sync", { expireInSeconds: 2 * 3600, retryLimit: 1 }).catch(() => {});
    await boss.schedule("cobranca-sync", process.env.JOBS_CRON_COBRANCA ?? "0 7 * * *", null, { tz });
    await boss.work("cobranca-sync", async () => {
      const r = await sincronizarPendentes();
      log("cobranca-sync", JSON.stringify(r));
      return r;
    });
  }

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

  log(`worker no ar (fuso ${tz}). Filas: alertas (1 h), backup-check (diário), exportacao, monitoramento-sync (diário), cobranca-sync (diário).`);

  const parar = async () => {
    log("encerrando…");
    clearInterval(timer);
    clearInterval(agente);
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
