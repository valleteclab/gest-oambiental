// Registro dos jobs do GED no worker (docs/ged-design.md). O worker chama `registrarJobsGed` uma vez;
// cada frente de trabalho tem o seu arquivo (jobs/ged-<x>.ts) exportando `registrar(boss, ctx)`:
//   ged-texto        – extração de texto dos PDFs (pdftotext) e, na fase 2, OCR
//   ged-assinaturas  – lembretes e expiração das solicitações de assinatura
//   ged-notificar    – envio das notificações (e-mail/WhatsApp) da caixa de saída
//   ged-backup       – replicação diária dos arquivos para o bucket de backup
import type { PgBoss } from "pg-boss";

export type BossGed = InstanceType<typeof PgBoss>;
export type CtxJobsGed = { tz: string; log: (...a: unknown[]) => void };

export async function registrarJobsGed(boss: BossGed, ctx: CtxJobsGed): Promise<void> {
  const modulos = await Promise.all([import("./ged-texto"), import("./ged-assinaturas"), import("./ged-notificar"), import("./ged-backup")]);
  for (const m of modulos) await m.registrar(boss, ctx);
}
