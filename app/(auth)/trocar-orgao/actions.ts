"use server";
import { redirect } from "next/navigation";
import { ERRO_ORGAO_SEM_ACESSO, definirOrgaoAtivo, getUsuario, resolverOrgao } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { isInterno, podeAcessarOrgao } from "@/lib/rbac";

/** Troca o órgão ativo sem novo login – mesma regra do login (podeAcessarOrgao). */
export async function trocarOrgao(_: { erro?: string } | undefined, form: FormData): Promise<{ erro?: string } | undefined> {
  const u = await getUsuario();
  if (!u) redirect("/login");
  const orgao = await resolverOrgao(String(form.get("orgao") ?? ""));
  if (!orgao) return { erro: "Selecione um órgão." };
  if (!podeAcessarOrgao(u.papeis, orgao.id)) {
    await auditar({ usuario_id: u.id, acao: "TROCA_ORGAO_NEGADA", entidade: "usuario", entidade_id: u.id, depois: { orgao: orgao.sigla, motivo: "orgao_sem_acesso" } });
    return { erro: ERRO_ORGAO_SEM_ACESSO };
  }
  await definirOrgaoAtivo(orgao);
  await auditar({ usuario_id: u.id, acao: "TROCA_ORGAO", entidade: "usuario", entidade_id: u.id, depois: { orgao: orgao.sigla } });
  const destino = String(form.get("next") ?? "");
  if (destino.startsWith("/") && !destino.startsWith("//")) redirect(destino);
  redirect(isInterno(u) ? "/dashboard" : "/meus-processos");
}
