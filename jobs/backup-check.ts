// Job diário "backup-check": avisa os administradores (e-mail, registrado em email_enviado) quando
// o último backup tem mais de 24 h ou o último teste de restauração tem mais de 31 dias (SPEC 9.2).
import { prisma } from "../lib/db";
import { enviarEmail } from "../lib/email";
import { situacaoBackup } from "../lib/backup/registrar";

export async function verificarBackup(agora = new Date()) {
  const s = await situacaoBackup(agora);
  const problemas: string[] = [];
  if (s.backupAtrasado) problemas.push(s.ultimoBackup ? `Último backup bem-sucedido há ${Math.floor(s.horasDesdeBackup!)} h (limite 24 h).` : "Nenhum backup registrado.");
  if (s.ultimaFalha) problemas.push(`Última execução de backup falhou: ${s.ultimaFalha.observacao ?? "sem detalhes"}.`);
  if (s.restoreAtrasado) problemas.push(s.ultimoRestore ? `Último teste de restauração há ${Math.floor(s.diasDesdeRestore!)} dias (periodicidade mensal).` : "Nenhum teste de restauração registrado.");
  if (problemas.length === 0) return { ok: true, avisados: 0 };

  const admins = await prisma.usuario.findMany({ where: { ativo: true, papeis: { some: { papel: "ADMIN" } } }, select: { email: true } });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/admin/backup`;
  for (const a of admins) {
    await enviarEmail(a.email, "[LicenciaGov] Atenção: backup/restauração fora do prazo", `<ul>${problemas.map((p) => `<li>${p}</li>`).join("")}</ul><p><a href="${url}">${url}</a></p>`);
  }
  return { ok: false, problemas, avisados: admins.length };
}
