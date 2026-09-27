"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUsuario, hashSenha, validarPoliticaSenha, verificarSenha } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { isInterno } from "@/lib/rbac";

export async function trocarSenha(_: { erro?: string } | undefined, form: FormData) {
  const u = await getUsuario();
  if (!u) redirect("/login");
  const atual = String(form.get("atual") ?? "");
  const nova = String(form.get("nova") ?? "");
  const conf = String(form.get("confirmacao") ?? "");
  const reg = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } });
  if (!(await verificarSenha(reg.senha_hash, atual))) return { erro: "Senha atual incorreta." };
  const politica = validarPoliticaSenha(nova);
  if (politica) return { erro: politica };
  if (nova !== conf) return { erro: "A confirmação não confere." };
  if (nova === atual) return { erro: "A nova senha deve ser diferente da atual." };
  await prisma.usuario.update({ where: { id: u.id }, data: { senha_hash: await hashSenha(nova), trocar_senha: false } });
  await auditar({ usuario_id: u.id, acao: "TROCAR_SENHA", entidade: "usuario", entidade_id: u.id });
  redirect(isInterno(u) ? "/dashboard" : "/meus-processos");
}
