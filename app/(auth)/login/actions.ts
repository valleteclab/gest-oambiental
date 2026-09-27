"use server";
import { redirect } from "next/navigation";
import { autenticar, criarSessao, resolverOrgao } from "@/lib/auth";
import { isInterno } from "@/lib/rbac";

export type EstadoLogin = { erro?: string; email?: string; orgao?: string } | undefined;

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "");
  const senha = String(form.get("senha") ?? "");
  const siglaOrgao = String(form.get("orgao") ?? "");
  const orgao = await resolverOrgao(siglaOrgao);
  if (!orgao) return { erro: "Selecione o órgão em que deseja entrar.", email, orgao: siglaOrgao };
  const r = await autenticar(email, senha, orgao);
  if (!r.ok) return { erro: r.erro, email, orgao: orgao.sigla };
  await criarSessao(r.usuario.id, orgao);
  const destino = String(form.get("next") ?? "");
  if (r.usuario.trocar_senha) redirect("/trocar-senha");
  if (destino.startsWith("/") && !destino.startsWith("//")) redirect(destino);
  redirect(isInterno(r.usuario) ? "/dashboard" : "/meus-processos");
}
