"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { atualizarTipoDocumento, criarTipoDocumento, excluirTipoDocumento } from "@/lib/ged/tipos-documento";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const depois = () => revalidatePath("/ged/admin/tipos");

export async function criarTipoAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await criarTipoDocumento(ctx, { nome: txt(f, "nome") });
    depois();
    return "Tipo criado.";
  });
}

export async function atualizarTipoAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await atualizarTipoDocumento(ctx, txt(f, "id"), { nome: txt(f, "nome") });
    depois();
    return "Tipo atualizado.";
  });
}

export async function excluirTipoAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await excluirTipoDocumento(ctx, txt(f, "id"));
    depois();
    return "Tipo excluído.";
  });
}
