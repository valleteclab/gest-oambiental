"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { salvarConfiguracoes } from "@/lib/ged/admin/configuracoes";
import { ctxGedApi } from "@/lib/ged/escopo";

export async function salvarConfiguracoesAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await salvarConfiguracoes(ctx, {
      assinatura_prazo_dias: String(f.get("assinatura_prazo_dias") ?? ""),
      lembrete_dias: String(f.get("lembrete_dias") ?? ""),
      retencao_acesso_log_dias: String(f.get("retencao_acesso_log_dias") ?? ""),
      cota_gb: String(f.get("cota_gb") ?? "").replace(",", "."),
    });
    revalidatePath("/ged/admin/configuracoes");
    return "Configurações salvas.";
  });
}
