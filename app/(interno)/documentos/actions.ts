"use server";
import { revalidatePath } from "next/cache";
import { getUsuario } from "@/lib/auth";
import { cancelarDocumento } from "@/lib/documentos";
import { substituirDocumento } from "@/lib/documentos/substituir";
import { ErroApi } from "@/lib/http";

export type EstadoAcao = { ok?: string; erro?: string; novoId?: string } | null;

function mensagem(e: unknown) {
  if (e instanceof ErroApi) return e.message;
  console.error(e);
  return "Não foi possível concluir a operação. Tente novamente.";
}

export async function acaoCancelar(_prev: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    await cancelarDocumento(String(fd.get("id")), String(fd.get("motivo") ?? ""), u);
    revalidatePath(`/documentos/${fd.get("id")}`);
    return { ok: "Documento cancelado. A página pública de validação já mostra CANCELADO." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function acaoSubstituir(_prev: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    const v = String(fd.get("validade_ate") ?? "");
    const novo = await substituirDocumento(String(fd.get("id")), String(fd.get("motivo") ?? ""), u, v ? { validade_ate: new Date(`${v}T12:00:00-03:00`) } : {});
    revalidatePath(`/documentos/${fd.get("id")}`);
    return { ok: `Documento substituto ${novo.numero} emitido.`, novoId: novo.id };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
