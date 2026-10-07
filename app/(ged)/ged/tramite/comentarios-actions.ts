"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { comentar } from "@/lib/ged/comentarios/servico";
import { ctxGedApi } from "@/lib/ged/escopo";

export async function comentarAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = String(f.get("documento_id") ?? "");
    await comentar(ctx, { documento_id: id, texto: String(f.get("texto") ?? ""), contexto: f.get("contexto") === "TRAMITE" ? "TRAMITE" : "GERAL" });
    if (/^[0-9a-f-]{36}$/i.test(id)) revalidatePath(`/ged/documentos/${id}`);
    return "Comentário publicado.";
  });
}
