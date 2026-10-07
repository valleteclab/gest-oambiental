"use server";
import { revalidatePath } from "next/cache";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, proibido } from "@/lib/http";
import { erroParaEstado, type EstadoAcao } from "@/lib/admin/guard";
import { desativarCertificado, podeTerCertificadoProprio, salvarCertificado } from "@/lib/assinatura/servico";

// e-CPF do PRÓPRIO servidor (titular USUARIO = usuário logado). Nunca aceita usuario_id do formulário.

export async function enviarMeuCertificado(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  try {
    const u = await getUsuario();
    if (!u) throw naoAutenticado();
    if (!podeTerCertificadoProprio(u)) throw proibido("Seu perfil não emite documentos oficiais.");
    const arquivo = f.get("arquivo");
    const c = await salvarCertificado(u, {
      arquivo: arquivo instanceof File && arquivo.size > 0 ? arquivo : null,
      senha: String(f.get("senha") ?? ""),
      titular: "USUARIO",
      usuario_id: u.id,
    });
    revalidatePath("/minha-conta/certificado");
    return { ok: true, mensagem: `Certificado de ${c.nome_titular} cadastrado. Os documentos que você emitir serão assinados com ele.` };
  } catch (e) {
    return erroParaEstado(e);
  }
}

export async function desativarMeuCertificado(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  try {
    const u = await getUsuario();
    if (!u) throw naoAutenticado();
    if (!podeTerCertificadoProprio(u)) throw proibido("Seu perfil não emite documentos oficiais.");
    await desativarCertificado(u, String(f.get("id") ?? ""), { proprio: true });
    revalidatePath("/minha-conta/certificado");
    return { ok: true, mensagem: "Certificado desativado." };
  } catch (e) {
    return erroParaEstado(e);
  }
}
