"use server";
// Server Actions de pastas (frente B). Cada ação refaz ctxGedApi(); o serviço checa papel + permissão na pasta.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { arquivarPasta, atualizarPasta, criarPasta, restaurarPasta } from "@/lib/ged/pastas";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const depois = () => revalidatePath("/ged/pastas");

export async function criarPastaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const r = await criarPasta(ctx, { nome: txt(f, "nome"), parent_id: txt(f, "parent_id") || null, sensibilidade_padrao: (txt(f, "sensibilidade_padrao") || undefined) as never });
    depois();
    redirect(`/ged/pastas?pasta=${r.id}`);
  });
}

export async function atualizarPastaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await atualizarPasta(ctx, txt(f, "id"), { nome: txt(f, "nome"), sensibilidade_padrao: txt(f, "sensibilidade_padrao") as never });
    depois();
    return "Pasta atualizada.";
  });
}

export async function moverPastaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await atualizarPasta(ctx, txt(f, "id"), { parent_id: txt(f, "parent_id") || null });
    depois();
    return "Pasta movida.";
  });
}

export async function arquivarPastaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    if (txt(f, "restaurar") === "true") {
      await restaurarPasta(ctx, txt(f, "id"));
      depois();
      return "Pasta restaurada.";
    }
    await arquivarPasta(ctx, txt(f, "id"));
    depois();
    redirect("/ged/pastas");
  });
}
