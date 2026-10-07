"use server";
// Server Actions de documentos (frente B). Cada ação refaz ctxGedApi() e o serviço checa a permissão de novo.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { invalido } from "@/lib/http";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { arquivarDocumento, atualizarMetadadosDocumento, criarDocumentoUpload, definirDadosPessoais, enviarNovaVersao, reprocessarTextoDocumento, restaurarDocumento } from "@/lib/ged/documentos/servico";
import { reprocessarOcrDocumento } from "@/lib/ged/ocr/reprocessar";
import { definirMarcadoresDocumento } from "@/lib/ged/marcadores";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const doc = (id: string) => revalidatePath(`/ged/documentos/${id}`);

async function arquivoDoForm(f: FormData) {
  const a = f.get("arquivo");
  if (!(a instanceof File) || a.size === 0) throw invalido("Escolha o arquivo PDF.");
  return { arquivo: Buffer.from(await a.arrayBuffer()), nome_arquivo: a.name, mime: a.type };
}

export async function criarDocumentoAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const r = await criarDocumentoUpload(ctx, {
      titulo: txt(f, "titulo"),
      tipo_id: txt(f, "tipo_id"),
      remetente: txt(f, "remetente"),
      data_documento: txt(f, "data_documento"),
      pasta_id: txt(f, "pasta_id"),
      sensibilidade: txt(f, "sensibilidade") as never,
      marcador_ids: f.getAll("marcador_ids").map(String),
      ...(await arquivoDoForm(f)),
    });
    revalidatePath("/ged/documentos");
    redirect(`/ged/documentos/${r.id}`);
  });
}

export async function atualizarMetadadosAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    const corpo: Record<string, unknown> = { titulo: txt(f, "titulo"), tipo_id: txt(f, "tipo_id"), remetente: txt(f, "remetente"), data_documento: txt(f, "data_documento") };
    // pasta e sensibilidade só chegam no formulário de quem tem Administrar
    if (f.has("pasta_id")) corpo.pasta_id = txt(f, "pasta_id");
    if (f.has("sensibilidade")) corpo.sensibilidade = txt(f, "sensibilidade");
    await atualizarMetadadosDocumento(ctx, id, corpo);
    doc(id);
    return "Informações atualizadas.";
  });
}

export async function definirMarcadoresAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    await definirMarcadoresDocumento(ctx, id, f.getAll("marcador_ids").map(String));
    doc(id);
    return "Marcadores atualizados.";
  });
}

export async function definirDadosPessoaisAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    const r = await definirDadosPessoais(ctx, id, txt(f, "contem") === "true");
    doc(id);
    return r.sensibilidade_rebaixada ? "Marcado. A sensibilidade foi alterada de Público para Restrito até a anonimização." : "Marcação atualizada.";
  });
}

export async function arquivarDocumentoAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    if (txt(f, "restaurar") === "true") await restaurarDocumento(ctx, id);
    else await arquivarDocumento(ctx, id);
    doc(id);
    revalidatePath("/ged/documentos");
    return txt(f, "restaurar") === "true" ? "Documento restaurado." : "Documento arquivado.";
  });
}

export async function novaVersaoAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    const r = await enviarNovaVersao(ctx, id, await arquivoDoForm(f));
    doc(id);
    return `Versão ${r.n} enviada.`;
  });
}

export async function reprocessarTextoAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    await reprocessarTextoDocumento(ctx, id);
    doc(id);
    return "A indexação do texto foi reiniciada.";
  });
}

export async function reprocessarOcrAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "id");
    await reprocessarOcrDocumento(ctx, id);
    doc(id);
    return "O OCR foi recolocado na fila.";
  });
}
