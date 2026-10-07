"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuario } from "@/lib/auth";
import { atualizarResponsavel, criarResponsavel } from "@/lib/cadastros/responsaveis";
import { formParaObjeto } from "@/lib/cadastros/validacao";
import { erroParaEstado, type EstadoAcao } from "@/lib/admin/guard";

export async function salvarResponsavel(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) redirect("/login");
  const id = String(form.get("id") ?? "");
  const dados = formParaObjeto(form);
  delete dados.id;
  let rid: string;
  try {
    rid = (id ? await atualizarResponsavel(u, id, dados) : await criarResponsavel(u, dados)).id;
  } catch (e) {
    return erroParaEstado(e);
  }
  revalidatePath("/responsaveis-tecnicos");
  redirect(`/responsaveis-tecnicos/${rid}?salvo=1`);
}
