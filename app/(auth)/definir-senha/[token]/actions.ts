"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { hashSenha, validarPoliticaSenha } from "@/lib/auth";
import { consumirConvite } from "@/lib/plataforma/convite";
import { ipBloqueado, ipDaRequisicao, MENSAGEM_MUITAS_TENTATIVAS, registrarFalhaIp } from "@/lib/limite-login";

// Definição de senha por convite (link de uso único enviado pelo operador da plataforma). Sem sessão: o token é a credencial.
export async function definirSenha(_: { erro?: string } | undefined, form: FormData) {
  const token = String(form.get("token") ?? "");
  const nova = String(form.get("nova") ?? "");
  const conf = String(form.get("confirmacao") ?? "");
  const chave = `convite:${ipDaRequisicao(await headers())}`;
  if (ipBloqueado(chave)) return { erro: MENSAGEM_MUITAS_TENTATIVAS };
  const politica = validarPoliticaSenha(nova);
  if (politica) return { erro: politica };
  if (nova !== conf) return { erro: "A confirmação não confere." };
  const ok = await consumirConvite(token, await hashSenha(nova));
  if (!ok) {
    registrarFalhaIp(chave);
    return { erro: "Este link é inválido, expirou ou já foi usado. Peça um novo convite ao administrador da plataforma." };
  }
  redirect("/login?senha=definida");
}
