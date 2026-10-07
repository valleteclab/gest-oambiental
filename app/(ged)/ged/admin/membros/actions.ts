"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { alterarPapelMembro, criarMembro, definirMembroAtivo, definirSetoresDoMembro, redefinirSenhaMembro } from "@/lib/ged/admin/membros";
import { ctxGedApi } from "@/lib/ged/escopo";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const depois = () => revalidatePath("/ged/admin/membros");

export async function criarMembroAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const r = await criarMembro(ctx, { nome: txt(f, "nome"), email: txt(f, "email"), cargo: txt(f, "cargo"), papel: txt(f, "papel"), setor_ids: f.getAll("setor_id").map(String) });
    depois();
    return r.senha_temporaria
      ? `Membro criado. Senha provisória (aparece só agora; anote e entregue com segurança): ${r.senha_temporaria}. A pessoa deverá trocá-la no primeiro acesso.`
      : "Usuário já existente nesta organização adicionado ao módulo (a senha dele não foi alterada).";
  });
}

export async function alterarPapelAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await alterarPapelMembro(await ctxGedApi(), txt(f, "id"), txt(f, "papel"));
    depois();
    return "Papel atualizado.";
  });
}

export async function alternarAtivoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ativo = txt(f, "ativo") === "true";
    await definirMembroAtivo(await ctxGedApi(), txt(f, "id"), ativo);
    depois();
    return ativo ? "Membro reativado." : "Membro desativado: perde o acesso ao módulo.";
  });
}

export async function definirSetoresAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await definirSetoresDoMembro(await ctxGedApi(), txt(f, "id"), f.getAll("setor_id").map(String));
    depois();
    return "Setores atualizados.";
  });
}

export async function redefinirSenhaAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const senha = await redefinirSenhaMembro(await ctxGedApi(), txt(f, "id"));
    depois();
    return `Nova senha provisória (aparece só agora): ${senha}. A pessoa deverá trocá-la no próximo acesso.`;
  });
}
