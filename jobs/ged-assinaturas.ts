// GED – lembretes e expiração das solicitações de assinatura (fila ged-assinaturas, varredura HORÁRIA).
//   - lembretes D-3/D-1/D0 (GedConfig.lembrete_dias) aos signatários pendentes, entre 8h e 20h (Brasília);
//   - após o prazo: solicitação EXPIRADA, pendentes EXPIRADO, documento volta a PUBLICADO, autor notificado;
//   - reconciliação: todas as assinaturas feitas mas selo não gravado (falha temporária) → sela de novo (idempotente).
// Lógica em lib/ged/assinaturas/lembretes.ts. Execução avulsa: `npx tsx jobs/ged-assinaturas.ts`.
import Module from "node:module";
import path from "node:path";
import type { BossGed, CtxJobsGed } from "./ged";

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  await boss.createQueue("ged-assinaturas", { expireInSeconds: 3600, retryLimit: 1 }).catch(() => {});
  // minuto 7: não disputa o :00 com os demais jobs horários
  await boss.schedule("ged-assinaturas", process.env.JOBS_CRON_GED_ASSINATURAS ?? "7 * * * *", null, { tz: ctx.tz });
  await boss.work("ged-assinaturas", async () => {
    const { varrerAssinaturas } = await import("../lib/ged/assinaturas/lembretes");
    const r = await varrerAssinaturas();
    ctx.log("ged-assinaturas", JSON.stringify(r));
    return r;
  });
}

if (require.main === module) {
  // "server-only" lança fora do Next: stub do pacote (igual a jobs/worker.ts)
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return path.resolve(__dirname, "../node_modules/server-only/empty.js");
    return original.call(this, req, ...rest);
  };
  try {
    process.loadEnvFile(path.resolve(__dirname, "../.env"));
  } catch {
    /* variáveis já no ambiente */
  }
  import("../lib/ged/assinaturas/lembretes")
    .then(async ({ varrerAssinaturas }) => console.log(JSON.stringify(await varrerAssinaturas())))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
