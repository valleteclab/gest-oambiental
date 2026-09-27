// Registro de backups e testes de restauração (SPEC 9.2 / T10). Usado pelos scripts em scripts/backup,
// pelo worker (backup-check) e pela página /admin/backup.
import { prisma } from "../db";
import { registrarAuditoria } from "../audit";

export type TipoBackup = "BACKUP" | "RESTORE_TESTE";

export type EntradaBackup = {
  tipo: TipoBackup;
  tamanho?: number | bigint | null;
  destino?: string | null;
  sucesso?: boolean;
  observacao?: string | null;
  executado_em?: Date;
  usuario_id?: string | null;
};

/** Grava uma linha em backup_registro e no log de auditoria. */
export async function registrarBackup(e: EntradaBackup) {
  const reg = await prisma.backupRegistro.create({
    data: {
      tipo: e.tipo,
      tamanho: e.tamanho === undefined || e.tamanho === null ? null : BigInt(e.tamanho),
      destino: e.destino ?? null,
      sucesso: e.sucesso ?? true,
      observacao: e.observacao ?? null,
      executado_em: e.executado_em ?? new Date(),
      created_by: e.usuario_id ?? null,
    },
  });
  await registrarAuditoria({
    usuario_id: e.usuario_id ?? null,
    acao: e.tipo === "BACKUP" ? "BACKUP_REGISTRO" : "RESTORE_TESTE",
    entidade: "backup_registro",
    entidade_id: reg.id,
    depois: { ...reg, tamanho: reg.tamanho?.toString() ?? null },
  });
  return reg;
}

export const registrarTesteRestauracao = (e: Omit<EntradaBackup, "tipo">) => registrarBackup({ ...e, tipo: "RESTORE_TESTE" });

/** Último backup bem-sucedido, último teste de restauração e últimos registros. */
export async function situacaoBackup(agora = new Date()) {
  const [ultimoBackup, ultimaFalha, ultimoRestore, historico] = await Promise.all([
    prisma.backupRegistro.findFirst({ where: { tipo: "BACKUP", sucesso: true }, orderBy: { executado_em: "desc" } }),
    prisma.backupRegistro.findFirst({ where: { tipo: "BACKUP", sucesso: false }, orderBy: { executado_em: "desc" } }),
    prisma.backupRegistro.findFirst({ where: { tipo: "RESTORE_TESTE" }, orderBy: { executado_em: "desc" } }),
    prisma.backupRegistro.findMany({ orderBy: { executado_em: "desc" }, take: 30 }),
  ]);
  const horasDesdeBackup = ultimoBackup ? (agora.getTime() - ultimoBackup.executado_em.getTime()) / 3600000 : null;
  const diasDesdeRestore = ultimoRestore ? (agora.getTime() - ultimoRestore.executado_em.getTime()) / 86400000 : null;
  return {
    ultimoBackup,
    ultimaFalha: ultimaFalha && (!ultimoBackup || ultimaFalha.executado_em > ultimoBackup.executado_em) ? ultimaFalha : null,
    ultimoRestore,
    historico,
    horasDesdeBackup,
    diasDesdeRestore,
    backupAtrasado: horasDesdeBackup === null || horasDesdeBackup > 24,
    restoreAtrasado: diasDesdeRestore === null || diasDesdeRestore > 31,
  };
}

/** Formata bytes em KB/MB/GB (pt-BR). */
export function fmtBytes(n: number | bigint | null | undefined): string {
  if (n === null || n === undefined) return "—";
  let v = Number(n);
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: i === 0 ? 0 : 1 })} ${u[i]}`;
}
