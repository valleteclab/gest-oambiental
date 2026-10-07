"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { definirCanalAtivo, desvincularCanal, salvarCanal, vincularCanal } from "@/lib/ged/admin/canal";
import { ctxGedApi } from "@/lib/ged/escopo";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const depois = () => revalidatePath("/ged/admin/canal");

export async function salvarCanalAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const publicos: Record<string, string> = {};
    const segredos: Record<string, string> = {};
    for (const [k, v] of f.entries()) {
      if (typeof v !== "string") continue;
      if (k.startsWith("p_")) publicos[k.slice(2)] = v;
      else if (k.startsWith("s_") && v) segredos[k.slice(2)] = v;
    }
    await salvarCanal(ctx, { id: txt(f, "id") || null, tipo: txt(f, "tipo"), nome: txt(f, "nome"), publicos, segredos });
    depois();
    return "Canal salvo e vinculado às notificações. Use “Conectar / QR Code” para parear o WhatsApp e “Enviar teste” para conferir.";
  });
}

export async function vincularCanalAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await vincularCanal(await ctxGedApi(), txt(f, "canal_id"));
    depois();
    return "Canal vinculado.";
  });
}

export async function desvincularCanalAction() {
  return comoEstadoForm(async () => {
    await desvincularCanal(await ctxGedApi());
    depois();
    return "Canal desvinculado: as notificações por WhatsApp ficam suspensas (os e-mails continuam).";
  });
}

export async function ativarCanalAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ativo = txt(f, "ativo") === "true";
    await definirCanalAtivo(await ctxGedApi(), txt(f, "canal_id"), ativo);
    depois();
    return ativo ? "Canal ativado." : "Canal desativado.";
  });
}
