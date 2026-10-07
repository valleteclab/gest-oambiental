"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { desativarCertificadoGed, enviarCertificado } from "@/lib/ged/admin/certificado";
import { ctxGedApi } from "@/lib/ged/escopo";

const depois = () => revalidatePath("/ged/admin/certificado");

export async function enviarCertificadoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const arq = f.get("arquivo");
    const c = await enviarCertificado(ctx, arq instanceof File ? arq : null, String(f.get("senha") ?? ""));
    depois();
    return `Certificado de ${c.nome_titular} cadastrado (${c.icp_brasil ? "ICP-Brasil" : "fora da ICP-Brasil – somente para teste, sem valor legal pleno"}). Use “Testar assinatura” para conferir.`;
  });
}

export async function desativarCertificadoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await desativarCertificadoGed(await ctxGedApi(), String(f.get("id") ?? ""));
    depois();
    return "Certificado desativado.";
  });
}
