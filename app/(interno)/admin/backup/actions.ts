"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { temPapel } from "@/lib/rbac";
import { registrarTesteRestauracao } from "@/lib/backup/registrar";
import { dispararEmSegundoPlano } from "@/lib/backup/executar";

const Esquema = z.object({
  observacao: z.string().trim().min(10, "Descreva o teste (mín. 10 caracteres).").max(2000),
  sucesso: z.enum(["true", "false"]),
  destino: z.string().trim().max(200).optional(),
});

export async function acaoRegistrarRestore(_: { erro?: string; ok?: boolean } | undefined, form: FormData) {
  const u = await getUsuario();
  if (!u) redirect("/login");
  if (!temPapel(u, "ADMIN")) return { erro: "Somente o administrador pode registrar testes de restauração." };
  const r = Esquema.safeParse({ observacao: form.get("observacao"), sucesso: form.get("sucesso") ?? "true", destino: form.get("destino") || undefined });
  if (!r.success) return { erro: r.error.issues[0]?.message ?? "Dados inválidos." };
  await registrarTesteRestauracao({ observacao: `[manual] ${r.data.observacao}`, sucesso: r.data.sucesso === "true", destino: r.data.destino ?? "teste manual", usuario_id: u.id });
  revalidatePath("/admin/backup");
  return { ok: true };
}

export type EstadoExecucao = { erro?: string; ok?: string } | undefined;

/**
 * "Executar backup agora" / "Executar teste de restauração agora" (ADMIN, auditado). O backup é da
 * infraestrutura inteira (todas as organizações): roda no processo web em segundo plano, com advisory
 * lock no banco impedindo execução simultânea com o worker. A página acompanha pelo lock.
 */
async function disparar(tipo: "backup" | "restore"): Promise<EstadoExecucao> {
  const u = await getUsuario();
  if (!u) redirect("/login");
  if (!temPapel(u, "ADMIN")) return { erro: "Somente o administrador pode executar backup/restauração." };
  await auditar({ usuario_id: u.id, acao: tipo === "backup" ? "BACKUP_SOLICITADO" : "RESTORE_TESTE_SOLICITADO", entidade: "backup_registro", entidade_id: null, depois: { origem: "manual" } });
  const r = await dispararEmSegundoPlano(tipo, { origem: `manual (${u.email})`, usuario_id: u.id });
  revalidatePath("/admin/backup");
  if (r === "iniciado") return { ok: tipo === "backup" ? "Backup iniciado." : "Teste de restauração iniciado." };
  if (r.status === "em_andamento") return { erro: r.mensagem };
  if (r.status === "falha") return { erro: `Falhou: ${r.mensagem}` };
  return { ok: "Concluído." };
}

export async function acaoExecutarBackup(): Promise<EstadoExecucao> {
  return disparar("backup");
}

export async function acaoExecutarRestore(): Promise<EstadoExecucao> {
  return disparar("restore");
}
