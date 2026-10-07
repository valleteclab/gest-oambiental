// Serviço do editor de texto (item 2 do edital): criar documento, autosave do rascunho, finalizar (PDF) e reabrir.
//
// Modelo de versões (sem mudança de schema):
//  - Criar: documento RASCUNHO + versão 1 (origem EDITOR, PDF-placeholder "rascunho.pdf", conteudo_html = rascunho).
//  - Autosave: atualiza `conteudo_html` da versão-rascunho (versão atual, origem EDITOR, documento RASCUNHO, não selada).
//  - Finalizar: gera o PDF (papel timbrado) e cria NOVA versão (origem EDITOR, mesmo HTML) → documento PUBLICADO.
//  - Editar documento finalizado ("reabrir"): nova versão-rascunho (cópia do PDF atual + HTML da última versão EDITOR),
//    documento volta a RASCUNHO; ao finalizar nasce outra versão. Versões nunca são apagadas/alteradas (exceto o HTML do rascunho).
// Autosave NÃO gera linha de auditoria a cada gravação (seria ruído); criar, reabrir e finalizar são auditados.
import { z } from "zod";
import { invalido, proibido } from "@/lib/http";
import { concederAclAoCriador } from "../acl";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../contratos";
import { exigirEncontrado } from "../db";
import { criarVersao } from "../documentos/versoes";
import { htmlParaTexto } from "../documentos/pdf-info";
import { proximoNumeroDocumentoGed } from "../numeracao";
import { podeCriarDocumento } from "../papeis";
import { exigirDocumento, exigirPasta } from "../permissoes";
import { lerArquivoGed } from "../storage";
import { zSensibilidade, zUuid } from "../tipos";
import { gerarPdfDocumento, pdfRascunhoVazio } from "./pdf";
import { estadoDoEditor, htmlTemConteudo, MAX_REMETENTE, MAX_TITULO, nomeArquivoPdf, type EstadoEditor } from "./regras";
import { MAX_HTML_EDITOR, sanitizarHtmlEditor } from "./sanitizar";
import type { Prisma } from "@prisma/client";

const opcional = (s: z.ZodType<string>) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), s.optional());

export const zNovoDocumentoEditor = z.object({
  titulo: z.string().trim().min(3, "Informe o título (mínimo 3 caracteres).").max(MAX_TITULO, `O título deve ter no máximo ${MAX_TITULO} caracteres.`),
  tipo_id: opcional(zUuid),
  remetente: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(MAX_REMETENTE).optional()),
  data_documento: opcional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")),
  sensibilidade: zSensibilidade.default("RESTRITO"),
  pasta_id: opcional(zUuid),
});

const dataCivil = (s: string | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

/** Cria o documento RASCUNHO e a versão-rascunho; devolve o id do documento. */
export async function criarDocumentoEditor(ctx: CtxGed, entrada: unknown): Promise<{ id: string; numero: string }> {
  if (!podeCriarDocumento(ctx)) throw proibido("Seu papel não permite criar documentos.");
  const e = zNovoDocumentoEditor.parse(entrada);
  if (e.pasta_id) await exigirPasta(ctx, e.pasta_id, "EDITAR");
  if (e.tipo_id) exigirEncontrado(await ctx.db.gedTipoDocumento.findUnique({ where: { id: e.tipo_id }, select: { id: true } }), "Tipo de documento não encontrado.");
  const placeholder = await pdfRascunhoVazio(e.titulo);
  return ctx.db.$transaction(
    async (tx) => {
      const numero = await proximoNumeroDocumentoGed(tx, ctx.organizacao_id);
      const doc = await tx.gedDocumento.create({
        data: {
          pasta_id: e.pasta_id ?? null,
          numero,
          titulo: e.titulo,
          tipo_id: e.tipo_id ?? null,
          remetente: e.remetente ?? null,
          data_documento: dataCivil(e.data_documento),
          status: "RASCUNHO",
          criado_por_id: ctx.usuario.id,
          sensibilidade: e.sensibilidade,
        } as Prisma.GedDocumentoUncheckedCreateInput,
        select: { id: true },
      });
      await auditarGed(ctx, { acao: "GED_DOCUMENTO_CRIADO", entidade: "ged_documento", entidade_id: doc.id, depois: { numero, titulo: e.titulo, origem: "EDITOR", pasta_id: e.pasta_id ?? null, sensibilidade: e.sensibilidade } }, tx);
      await concederAclAoCriador(tx, ctx, { tipo: "documento", id: doc.id });
      await criarVersao(tx, ctx, { documento_id: doc.id, origem: "EDITOR", arquivo: placeholder, nome_arquivo: "rascunho.pdf", mime: "application/pdf", conteudo_html: "" });
      return { id: doc.id, numero };
    },
    { timeout: 20_000 },
  );
}

export type DadosEditor = {
  documento: { id: string; numero: string; titulo: string; status: string; sensibilidade: string };
  estado: EstadoEditor;
  html: string;
  /** Marca de concorrência do rascunho (ISO). */
  atualizado_em: string | null;
};

/** Carrega o necessário para a tela do editor. Exige EDITAR (ASSINADO/sem permissão → 403; sem VER/outro cliente → 404). */
export async function abrirEditor(ctx: CtxGed, documentoId: string): Promise<DadosEditor> {
  const { doc } = await exigirDocumento(ctx, documentoId, "EDITAR");
  const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: documentoId }, select: { numero: true, titulo: true, versao_atual_id: true } }), "Documento não encontrado.");
  const atual = d.versao_atual_id ? await ctx.db.gedVersaoDocumento.findUnique({ where: { id: d.versao_atual_id }, select: { origem: true, selada: true, conteudo_html: true, updated_at: true } }) : null;
  const ultimaEditor = await ctx.db.gedVersaoDocumento.findFirst({ where: { documento_id: documentoId, origem: "EDITOR", conteudo_html: { not: null } }, orderBy: { n: "desc" }, select: { conteudo_html: true } });
  const estado = estadoDoEditor({ status: doc.status, versao_atual_origem: atual?.origem ?? null, versao_atual_selada: atual?.selada ?? false, temVersaoEditor: !!ultimaEditor });
  const html = estado.tipo === "RASCUNHO" ? (atual?.conteudo_html ?? "") : (ultimaEditor?.conteudo_html ?? "");
  return { documento: { id: documentoId, numero: d.numero, titulo: d.titulo, status: doc.status, sensibilidade: doc.sensibilidade }, estado, html, atualizado_em: estado.tipo === "RASCUNHO" && atual ? atual.updated_at.toISOString() : null };
}

function validarHtmlEntrada(html: unknown): string {
  if (typeof html !== "string") throw invalido("Conteúdo inválido.");
  if (html.length > MAX_HTML_EDITOR * 2) throw invalido("O documento é grande demais para o editor.");
  const limpo = sanitizarHtmlEditor(html);
  if (limpo.length > MAX_HTML_EDITOR) throw invalido("O documento é grande demais para o editor.");
  return limpo;
}

/** Versão-rascunho do documento (exige o estado RASCUNHO). */
async function versaoRascunho(ctx: CtxGed, documentoId: string) {
  const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: documentoId }, select: { status: true, versao_atual_id: true } }), "Documento não encontrado.");
  const v = d.versao_atual_id ? await ctx.db.gedVersaoDocumento.findUnique({ where: { id: d.versao_atual_id }, select: { id: true, origem: true, selada: true, updated_at: true } }) : null;
  if (!v || d.status !== "RASCUNHO" || v.origem !== "EDITOR" || v.selada) throw invalido("O documento não está em edição. Recarregue a página.");
  return v;
}

export type ResultadoAutosave = { ok: true; atualizado_em: string } | { ok: false; conflito: true; atualizado_em: string };

/** Autosave (idempotente). `base_em`: marca recebida no último salvamento; se diferir, outra janela salvou antes (conflito). */
export async function salvarRascunho(ctx: CtxGed, entrada: { documento_id: string; html: unknown; base_em?: string | null; forcar?: boolean }): Promise<ResultadoAutosave> {
  await exigirDocumento(ctx, entrada.documento_id, "EDITAR");
  const html = validarHtmlEntrada(entrada.html);
  const v = await versaoRascunho(ctx, entrada.documento_id);
  if (!entrada.forcar && entrada.base_em && new Date(entrada.base_em).getTime() !== v.updated_at.getTime()) {
    return { ok: false, conflito: true, atualizado_em: v.updated_at.toISOString() };
  }
  const r = await ctx.db.gedVersaoDocumento.update({ where: { id: v.id }, data: { conteudo_html: html }, select: { updated_at: true } });
  return { ok: true, atualizado_em: r.updated_at.toISOString() };
}

/** Finaliza: gera o PDF e cria a nova versão; documento → PUBLICADO. */
export async function finalizarDocumento(ctx: CtxGed, entrada: { documento_id: string; html: unknown }): Promise<{ versao_id: string; n: number; sha256: string }> {
  await exigirDocumento(ctx, entrada.documento_id, "EDITAR");
  const html = validarHtmlEntrada(entrada.html);
  if (!htmlTemConteudo(htmlParaTexto(html))) throw invalido("O documento está vazio: escreva o conteúdo antes de finalizar.");
  await versaoRascunho(ctx, entrada.documento_id);
  const d = exigirEncontrado(
    await ctx.db.gedDocumento.findUnique({ where: { id: entrada.documento_id }, select: { numero: true, titulo: true, remetente: true, data_documento: true, tipo_id: true } }),
    "Documento não encontrado.",
  );
  const tipo = d.tipo_id ? await ctx.db.gedTipoDocumento.findUnique({ where: { id: d.tipo_id }, select: { nome: true } }) : null;
  const pdf = await gerarPdfDocumento({ organizacao: ctx.organizacao, numero: d.numero, titulo: d.titulo, tipo: tipo?.nome ?? null, remetente: d.remetente, data_documento: d.data_documento, html });
  return ctx.db.$transaction(
    async (tx) => {
      const v = await criarVersao(tx, ctx, { documento_id: entrada.documento_id, origem: "EDITOR", arquivo: pdf, nome_arquivo: nomeArquivoPdf(d.titulo), mime: "application/pdf", conteudo_html: html });
      await tx.gedDocumento.update({ where: { id: entrada.documento_id }, data: { status: "PUBLICADO" } });
      await auditarGed(ctx, { acao: "GED_EDITOR_FINALIZADO", entidade: "ged_documento", entidade_id: entrada.documento_id, antes: { status: "RASCUNHO" }, depois: { status: "PUBLICADO", versao_id: v.id, n: v.n, sha256: v.sha256, tamanho_html: html.length } }, tx);
      return { versao_id: v.id, n: v.n, sha256: v.sha256 };
    },
    { timeout: 20_000 },
  );
}

/** "Editar" um documento já finalizado: cria nova versão-rascunho e volta o documento a RASCUNHO. */
export async function reabrirParaEdicao(ctx: CtxGed, documentoId: string): Promise<void> {
  const dados = await abrirEditor(ctx, documentoId);
  if (dados.estado.tipo === "RASCUNHO") return;
  if (dados.estado.tipo === "BLOQUEADO") throw invalido(dados.estado.motivo);
  const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: documentoId }, select: { versao_atual_id: true } }), "Documento não encontrado.");
  const atual = exigirEncontrado(d.versao_atual_id ? await ctx.db.gedVersaoDocumento.findUnique({ where: { id: d.versao_atual_id }, select: { storage_key: true, mime: true } }) : null, "Versão atual não encontrada.");
  const arquivo = await lerArquivoGed(ctx.organizacao_id, atual.storage_key);
  await ctx.db.$transaction(async (tx) => {
    await criarVersao(tx, ctx, { documento_id: documentoId, origem: "EDITOR", arquivo, nome_arquivo: "rascunho.pdf", mime: atual.mime, conteudo_html: dados.html });
    await tx.gedDocumento.update({ where: { id: documentoId }, data: { status: "RASCUNHO" } });
    await auditarGed(ctx, { acao: "GED_EDITOR_REABERTO", entidade: "ged_documento", entidade_id: documentoId, antes: { status: dados.documento.status }, depois: { status: "RASCUNHO" } }, tx);
  }, { timeout: 20_000 });
}
