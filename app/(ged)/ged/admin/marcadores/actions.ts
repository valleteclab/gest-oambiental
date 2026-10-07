"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { atualizarMarcador, criarMarcador, excluirMarcador } from "@/lib/ged/marcadores";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const depois = () => revalidatePath("/ged/admin/marcadores");

export async function criarMarcadorAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await criarMarcador(ctx, { nome: txt(f, "nome"), cor: txt(f, "cor") || undefined });
    depois();
    return "Marcador criado.";
  });
}

export async function atualizarMarcadorAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await atualizarMarcador(ctx, txt(f, "id"), { nome: txt(f, "nome"), cor: txt(f, "cor") || undefined });
    depois();
    return "Marcador atualizado.";
  });
}

export async function excluirMarcadorAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await excluirMarcador(ctx, txt(f, "id"));
    depois();
    return "Marcador excluído.";
  });
}
