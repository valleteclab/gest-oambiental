"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuario } from "@/lib/auth";
import { atualizarPessoa, criarPessoa } from "@/lib/cadastros/pessoas";
import { formParaObjeto } from "@/lib/cadastros/validacao";
import { erroParaEstado, type EstadoAcao } from "@/lib/admin/guard";

export async function salvarPessoa(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) redirect("/login");
  const id = String(form.get("id") ?? "");
  const dados = formParaObjeto(form);
  delete dados.id;
  let destino: string;
  try {
    const p = id ? await atualizarPessoa(u, id, dados) : await criarPessoa(u, dados);
    destino = `/pessoas/${p.id}`;
  } catch (e) {
    const est = erroParaEstado(e);
    const det = (e as { details?: { pessoa_id?: string | null } }).details;
    if (det?.pessoa_id) return { ...est, extra: { existente: det.pessoa_id } };
    return est;
  }
  revalidatePath("/pessoas");
  redirect(`${destino}?salvo=1`);
}
