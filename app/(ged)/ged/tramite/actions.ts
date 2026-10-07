"use server";
// Server Actions do trâmite. Cada ação refaz sessão + permissão (TRAMITAR) dentro de lib/ged/tramite/acoes.ts.
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { arquivarDocumento, darCiencia, despachar, devolver, enviarDocumento } from "@/lib/ged/tramite/acoes";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const UUID = /^[0-9a-f-]{36}$/i;
function depois(documentoId: string) {
  if (UUID.test(documentoId)) revalidatePath(`/ged/documentos/${documentoId}`);
  revalidatePath("/ged/tramite");
}

export async function enviarAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const [tipo, id] = txt(f, "destino").split(":");
    await enviarDocumento(ctx, { documento_id: txt(f, "documento_id"), destino: { tipo, id }, despacho: txt(f, "despacho"), prazo: txt(f, "prazo") });
    depois(txt(f, "documento_id"));
    return "Documento enviado.";
  });
}

export async function despacharAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await despachar(ctx, { documento_id: txt(f, "documento_id"), despacho: txt(f, "despacho") });
    depois(txt(f, "documento_id"));
    return "Despacho registrado.";
  });
}

export async function cienciaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await darCiencia(ctx, { documento_id: txt(f, "documento_id"), despacho: txt(f, "despacho") });
    depois(txt(f, "documento_id"));
    return "Ciência registrada.";
  });
}

export async function devolverAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await devolver(ctx, { documento_id: txt(f, "documento_id"), despacho: txt(f, "despacho") });
    depois(txt(f, "documento_id"));
    return "Documento devolvido.";
  });
}

export async function arquivarAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await arquivarDocumento(ctx, { documento_id: txt(f, "documento_id"), despacho: txt(f, "despacho") });
    depois(txt(f, "documento_id"));
    return "Documento arquivado.";
  });
}
