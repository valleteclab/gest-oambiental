"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuario } from "@/lib/auth";
import { atualizarEmpreendimento, criarEmpreendimento } from "@/lib/cadastros/empreendimentos";
import { formParaObjeto } from "@/lib/cadastros/validacao";
import { erroParaEstado, type EstadoAcao } from "@/lib/admin/guard";

export async function salvarEmpreendimento(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) redirect("/login");
  const id = String(form.get("id") ?? "");
  const dados = formParaObjeto(form);
  delete dados.id;
  // "ajustar_porte" desmarcado → porte automático (limpa justificativa)
  if (dados.ajustar_porte !== "1") {
    dados.porte = null;
    dados.porte_justificativa = null;
  }
  delete dados.ajustar_porte;
  let eid: string;
  try {
    eid = (id ? await atualizarEmpreendimento(u, id, dados) : await criarEmpreendimento(u, dados)).id;
  } catch (e) {
    return erroParaEstado(e);
  }
  revalidatePath("/empreendimentos");
  redirect(`/empreendimentos/${eid}?salvo=1`);
}
