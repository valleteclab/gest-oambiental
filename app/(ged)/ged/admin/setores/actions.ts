"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { atualizarSetor, criarSetor, definirMembroSetor, definirSetorAtivo, removerMembroSetor } from "@/lib/ged/setores";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const depois = () => revalidatePath("/ged/admin/setores");

export async function criarSetorAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await criarSetor(ctx, { nome: txt(f, "nome"), sigla: txt(f, "sigla") });
    depois();
    return "Setor criado.";
  });
}

export async function atualizarSetorAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await atualizarSetor(ctx, txt(f, "id"), { nome: txt(f, "nome"), sigla: txt(f, "sigla") });
    depois();
    return "Setor atualizado.";
  });
}

export async function alternarSetorAtivoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await definirSetorAtivo(ctx, txt(f, "id"), txt(f, "ativo") === "true");
    depois();
    return "Situação do setor atualizada.";
  });
}

export async function adicionarMembroSetorAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await definirMembroSetor(ctx, txt(f, "setor_id"), txt(f, "usuario_id"), txt(f, "chefe") === "on");
    depois();
    return "Participante salvo.";
  });
}

export async function removerMembroSetorAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await removerMembroSetor(ctx, txt(f, "setor_id"), txt(f, "usuario_id"));
    depois();
    return "Participante removido.";
  });
}
