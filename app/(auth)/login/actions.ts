"use server";
import { redirect } from "next/navigation";
import { autenticar, criarSessao } from "@/lib/auth";
import { isInterno } from "@/lib/rbac";

export async function entrar(_: { erro?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "");
  const senha = String(form.get("senha") ?? "");
  const r = await autenticar(email, senha);
  if (!r.ok) return { erro: r.erro };
  await criarSessao(r.usuario.id);
  const destino = String(form.get("next") ?? "");
  if (r.usuario.trocar_senha) redirect("/trocar-senha");
  if (destino.startsWith("/") && !destino.startsWith("//")) redirect(destino);
  redirect(isInterno(r.usuario) ? "/dashboard" : "/meus-processos");
}
