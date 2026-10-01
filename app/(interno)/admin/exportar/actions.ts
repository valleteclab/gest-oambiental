"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contextoRequisicao, getUsuario } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { solicitarExportacao } from "@/lib/export/exportar";

export async function acaoSolicitarExportacao(): Promise<void> {
  const u = await getUsuario();
  if (!u) redirect("/login");
  if (!can(u, "exportar", "exportacao")) redirect("/admin/exportar?erro=403");
  await solicitarExportacao(u, "COMPLETA", await contextoRequisicao());
  revalidatePath("/admin/exportar");
  redirect("/admin/exportar?ok=1");
}
