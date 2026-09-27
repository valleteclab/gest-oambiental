"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { temPapel } from "@/lib/rbac";
import { registrarTesteRestauracao } from "@/lib/backup/registrar";

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
