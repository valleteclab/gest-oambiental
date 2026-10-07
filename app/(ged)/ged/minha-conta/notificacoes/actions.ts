"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { confirmarCodigoWhatsapp, revogarWhatsapp, salvarPreferencias, solicitarCodigoWhatsapp } from "@/lib/ged/notificar/preferencias";
import { EVENTOS_CONFIGURAVEIS } from "@/lib/ged/notificar/regras";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const depois = () => revalidatePath("/ged/minha-conta/notificacoes");

export async function salvarPreferenciasAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await salvarPreferencias(ctx, EVENTOS_CONFIGURAVEIS.map((evento) => ({ evento, email: f.get(`email_${evento}`) === "on", whatsapp: f.get(`whatsapp_${evento}`) === "on" })));
    depois();
    return "Preferências salvas.";
  });
}

export async function solicitarCodigoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const r = await solicitarCodigoWhatsapp(ctx, txt(f, "telefone"));
    depois();
    return `Enviamos um código de 6 dígitos para ${r.telefone_mascarado}. Ele pode levar alguns segundos para chegar e vale por 10 minutos.`;
  });
}

export async function confirmarCodigoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await confirmarCodigoWhatsapp(ctx, txt(f, "codigo"));
    depois();
    return "Telefone confirmado. As notificações por WhatsApp marcadas abaixo passam a ser enviadas.";
  });
}

export async function revogarWhatsappAction() {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await revogarWhatsapp(ctx);
    depois();
    return "WhatsApp desativado e telefone removido.";
  });
}
