"use server";
// Server Actions do editor. Cada uma refaz a checagem de sessão/permissão (nunca confie no front).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarDocumentoEditor, finalizarDocumento, reabrirParaEdicao, salvarRascunho, type ResultadoAutosave } from "@/lib/ged/editor/servico";
import { ErroApi } from "@/lib/http";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function criarDocumentoEditorAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const r = await criarDocumentoEditor(ctx, {
      titulo: txt(f, "titulo"),
      tipo_id: txt(f, "tipo_id"),
      remetente: txt(f, "remetente"),
      data_documento: txt(f, "data_documento"),
      sensibilidade: txt(f, "sensibilidade") || "RESTRITO",
      pasta_id: txt(f, "pasta_id"),
    });
    redirect(`/ged/editor/${r.id}`);
  });
}

export type RespostaAutosave = ResultadoAutosave | { ok: false; erro: string };

function mensagem(e: unknown): string {
  if (e instanceof ErroApi) return e.status === 404 ? "Documento não encontrado." : e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Dados inválidos.";
  console.error(e);
  return "Não foi possível salvar.";
}

/** Autosave chamado pelo componente cliente (debounce). Não lança: devolve o estado. */
export async function salvarRascunhoAction(entrada: { documento_id: string; html: string; base_em: string | null; forcar?: boolean }): Promise<RespostaAutosave> {
  try {
    const ctx = await ctxGedApi();
    return await salvarRascunho(ctx, entrada);
  } catch (e) {
    return { ok: false, erro: mensagem(e) };
  }
}

/** Finaliza e redireciona para a página do documento; em caso de erro devolve a mensagem. */
export async function finalizarAction(entrada: { documento_id: string; html: string }): Promise<{ erro: string } | undefined> {
  try {
    const ctx = await ctxGedApi();
    await finalizarDocumento(ctx, entrada);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    return { erro: mensagem(e) };
  }
  revalidatePath(`/ged/documentos/${entrada.documento_id}`);
  redirect(`/ged/documentos/${entrada.documento_id}`);
}

export async function reabrirAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const id = txt(f, "documento_id");
    await reabrirParaEdicao(ctx, id);
    revalidatePath(`/ged/documentos/${id}`);
    redirect(`/ged/editor/${id}`);
  });
}
