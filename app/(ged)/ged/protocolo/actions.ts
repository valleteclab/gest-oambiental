"use server";
// Server Actions do protocolo. Cada ação refaz ctxGedApi() e o serviço checa papel/envolvimento de novo.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { invalido } from "@/lib/http";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { emitirComprovanteProtocolo, executarAcaoProtocolo, registrarProtocolo, carregarProtocolo, type AnexoEntrada } from "@/lib/ged/protocolo/servico";
import { podeRegistrarProtocolo } from "@/lib/ged/protocolo/regras";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function arquivos(f: FormData, campo: string): Promise<AnexoEntrada[]> {
  const out: AnexoEntrada[] = [];
  for (const a of f.getAll(campo)) if (a instanceof File && a.size > 0) out.push({ arquivo: Buffer.from(await a.arrayBuffer()), nome_arquivo: a.name, mime: a.type });
  return out;
}

/** "SETOR:uuid" | "USUARIO:uuid" → { destino_setor_id } | { destino_usuario_id } */
function destino(v: string): { destino_setor_id?: string; destino_usuario_id?: string } {
  const [tipo, id] = v.split(":");
  if (!id) return {};
  return tipo === "SETOR" ? { destino_setor_id: id } : tipo === "USUARIO" ? { destino_usuario_id: id } : {};
}

export async function registrarProtocoloAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const livro = txt(f, "livro");
    const r = await registrarProtocolo(ctx, {
      livro,
      assunto: txt(f, "assunto"),
      descricao: txt(f, "descricao"),
      tipo_documento_id: txt(f, "tipo_documento_id"),
      prioridade: txt(f, "prioridade"),
      prazo_resposta: txt(f, "prazo_resposta"),
      origem_setor_id: txt(f, "origem_setor_id"),
      interessado: { nome: txt(f, "i_nome"), cpf_cnpj: txt(f, "i_cpf_cnpj"), email: txt(f, "i_email"), telefone: txt(f, "i_telefone") },
      ...destino(txt(f, "destino")),
    }, await arquivos(f, "arquivos"));
    revalidatePath("/ged/protocolo");
    redirect(`/ged/protocolo/${r.id}`);
  });
}

export async function acaoProtocoloAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    const anexos = await arquivos(f, "arquivo");
    const acao = txt(f, "acao");
    const r = await executarAcaoProtocolo(ctx, id, { acao, texto: txt(f, "texto") || undefined, ...destino(txt(f, "destino")) }, anexos[0] ?? null);
    revalidatePath(`/ged/protocolo/${id}`);
    revalidatePath("/ged/protocolo");
    return `Situação: ${r.situacao.replace("_", " ").toLowerCase()}.`;
  });
}

export async function emitirComprovanteAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    const { p, agir } = await carregarProtocolo(ctx, id);
    if (!agir || !podeRegistrarProtocolo(ctx.membro.papel)) throw invalido("Você não pode emitir o comprovante deste protocolo.");
    await emitirComprovanteProtocolo(ctx, p.id);
    revalidatePath(`/ged/protocolo/${id}`);
    return "Comprovante emitido.";
  });
}
