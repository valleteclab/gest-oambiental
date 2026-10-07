// Registro dos jobs do GED no worker (docs/ged-design.md). O worker chama `registrarJobsGed` uma vez;
// cada frente de trabalho tem o seu arquivo (jobs/ged-<x>.ts) exportando `registrar(boss, ctx)`:
//   ged-texto        – extração de texto dos PDFs (pdftotext) e, na fase 2, OCR
//   ged-assinaturas  – lembretes e expiração das solicitações de assinatura
//   ged-notificar    – envio das notificações (e-mail/WhatsApp) da caixa de saída
//   ged-backup       – replicação diária dos arquivos para o bucket de backup
//   ged-ocr          – OCR no servidor (ocrmypdf) dos PDFs digitalizados; worker dedicado: JOBS_FILAS=ged-ocr (GED_OCR_DESATIVADO=true desliga)
//   ged-importar     – importação em lote de ZIP (lib/ged/importacao)
import type { PgBoss } from "pg-boss";

export type BossGed = InstanceType<typeof PgBoss>;
export type CtxJobsGed = { tz: string; log: (...a: unknown[]) => void };

export async function registrarJobsGed(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const modulos = await Promise.all([import("./ged-texto"), import("./ged-assinaturas"), import("./ged-notificar"), import("./ged-backup"), import("./ged-importar")]);
  for (const m of modulos) await m.registrar(boss, ctx);
  if (process.env.GED_OCR_DESATIVADO !== "true") await (await import("./ged-ocr")).registrar(boss, ctx);
}
