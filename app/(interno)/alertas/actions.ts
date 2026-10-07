"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUsuario } from "@/lib/auth";
import { marcarAlertaLido, marcarTodosLidos } from "@/lib/alertas/consultas";

export async function acaoMarcarLido(form: FormData) {
  const u = await getUsuario();
  if (!u) redirect("/login");
  const id = String(form.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) await marcarAlertaLido(id, u.id);
  revalidatePath("/", "layout");
}

export async function acaoMarcarTodosLidos() {
  const u = await getUsuario();
  if (!u) redirect("/login");
  await marcarTodosLidos(u.id);
  revalidatePath("/", "layout");
}
