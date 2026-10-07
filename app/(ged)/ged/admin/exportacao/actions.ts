"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { comoEstadoForm } from "@/lib/ged/acoes";
import { solicitarExportacaoGed } from "@/lib/ged/admin/exportacao";
import { ctxGedApi } from "@/lib/ged/escopo";

export async function solicitarExportacaoAction() {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const h = await headers();
    await solicitarExportacaoGed(ctx, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, user_agent: h.get("user-agent") });
    revalidatePath("/ged/admin/exportacao");
    return "Exportação solicitada. Quando concluir, o arquivo fica disponível para download abaixo.";
  });
}
