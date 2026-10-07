// Replicação dos arquivos (uploads) para o destino de backup – filas `storage-replicar` (diária) e
// `storage-reconciliar` (semanal). Implementação: lib/backup/arquivos.ts (docs/backup.md §4, docs/ged-design.md §9).
//   storage-replicar     JOBS_CRON_REPLICACAO       (padrão "0 3 * * *")   copia o que foi criado após a última marca d'água
//   storage-reconciliar  JOBS_CRON_RECONCILIACAO    (padrão "30 4 * * 0")   compara banco × destino e copia o que faltar
// Cada execução vira uma linha em backup_registro (tipo REPLICACAO_ARQUIVOS); falha => e-mail para BACKUP_ALERTA_EMAIL.
import type { BossGed, CtxJobsGed } from "./ged";

async function alertar(assunto: string, texto: string) {
  const dest = (process.env.BACKUP_ALERTA_EMAIL ?? "").split(/[,;\s]+/).filter(Boolean);
  if (!dest.length) return;
  const { enviarEmail } = await import("../lib/email");
  const esc = texto.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  for (const d of dest) await enviarEmail(d, `[LicenciaGov] ${assunto}`, `<p>${esc}</p>`).catch((e) => console.error("[ged-backup] e-mail de alerta", e));
}

export async function registrar(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const cronDiario = process.env.JOBS_CRON_REPLICACAO?.trim() || "0 3 * * *";
  const cronSemanal = process.env.JOBS_CRON_RECONCILIACAO?.trim() || "30 4 * * 0";
  for (const q of ["storage-replicar", "storage-reconciliar"]) await boss.createQueue(q, { expireInSeconds: 6 * 3600, retryLimit: 0 }).catch(() => {});
  await boss.schedule("storage-replicar", cronDiario, null, { tz: ctx.tz });
  await boss.schedule("storage-reconciliar", cronSemanal, null, { tz: ctx.tz });

  await boss.work("storage-replicar", async () => {
    const { replicarArquivos } = await import("../lib/backup/arquivos");
    const r = await replicarArquivos({ origem: "agendado (worker)" });
    ctx.log("storage-replicar", JSON.stringify(r));
    if (r.status === "falha") await alertar("Falha na replicação de arquivos", `Replicação de arquivos com ${r.erros} erro(s) (registro ${r.registro_id}). Veja backup_registro / /admin/backup.`);
    return r;
  });
  await boss.work("storage-reconciliar", async () => {
    const { reconciliarArquivos } = await import("../lib/backup/arquivos");
    const r = await reconciliarArquivos({ origem: "agendado semanal (worker)" });
    ctx.log("storage-reconciliar", JSON.stringify(r));
    if (r.status === "falha") await alertar("Falha na reconciliação de arquivos", `Reconciliação de arquivos com ${r.erros} erro(s) (registro ${r.registro_id}).`);
    return r;
  });
  ctx.log(`replicação de arquivos agendada: "${cronDiario}", reconciliação: "${cronSemanal}" (${ctx.tz}).`);
}
