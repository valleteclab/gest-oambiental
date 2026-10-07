// Versões de documento (contrato da frente B – lib/ged/contratos.ts). Funciona dentro da transação do chamador.
//
//  - sha256 do arquivo; próximo `n` seguro contra concorrência (o UPDATE no documento trava a linha até o commit, então
//    duas criarVersao simultâneas se enfileiram; o índice único (documento_id, n) é a rede de segurança);
//  - arquivo em `ged/{org}/{ano}/{doc}/v{n}-{sha8}.pdf` via salvarArquivoGed (UPLOAD/SCAN passam pelo antivírus);
//  - origem EDITOR já grava o texto indexável a partir do HTML (sem pdftotext); as demais ficam `texto_status=PENDENTE`
//    para o job ged-extrair-texto;
//  - documento ASSINADO ou com versão selada só aceita nova versão de origem SELO.
// NÃO verifica permissão (quem chama já verificou) e NÃO abre transação.
import { createHash } from "node:crypto";
import { invalido } from "@/lib/http";
import type { GedOrigemVersao, Prisma } from "@prisma/client";
import { auditarGed } from "../auditoria";
import type { CriarVersaoInput, CriarVersaoResultado, CtxGed, GedTx } from "../contratos";
import { exigirEncontrado } from "../db";
import { chaveGed, salvarArquivoGed } from "../storage";
import { contarPaginasPdf, htmlParaTexto } from "./pdf-info";
import { cancelarSolicitacoesAbertas } from "../assinaturas/cancelamento";

/** Origens de versão que mudam o conteúdo do documento (e portanto invalidam uma solicitação de assinatura aberta). */
const ORIGENS_QUE_CANCELAM_ASSINATURA: readonly GedOrigemVersao[] = ["UPLOAD", "EDITOR", "SCAN"];

/** Origens que representam arquivo enviado por pessoa (passam pelo antivírus). */
export const ORIGENS_COM_UPLOAD: readonly GedOrigemVersao[] = ["UPLOAD", "SCAN"];

export const sha256Hex = (dados: Buffer) => createHash("sha256").update(dados).digest("hex");

/** PURA: próximo número de versão a partir do maior existente. */
export const proximoNumeroVersao = (maiorAtual: number | null | undefined) => (maiorAtual ?? 0) + 1;

/** PURA: a nova versão é permitida neste estado? (documento assinado/selado só aceita o SELO). */
export function podeNovaVersao(estado: { status: string; ultimaSelada: boolean }, origem: GedOrigemVersao): boolean {
  if (origem === "SELO") return true;
  return estado.status !== "ASSINADO" && !estado.ultimaSelada;
}

function extensaoDoMime(mime: string, nome: string): string {
  if (/pdf/i.test(mime)) return "pdf";
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(nome);
  return m ? m[1].toLowerCase() : "bin";
}

export async function criarVersao(tx: GedTx, ctx: CtxGed, input: CriarVersaoInput): Promise<CriarVersaoResultado> {
  if (!input.arquivo || input.arquivo.length === 0) throw invalido("Arquivo vazio.");
  const sha256 = sha256Hex(input.arquivo);
  const ehPdf = /pdf/i.test(input.mime);
  const paginas = ehPdf ? await contarPaginasPdf(input.arquivo) : null;

  // Trava o documento (também o tenant-escopa): serializa a numeração de versões do mesmo documento.
  const doc = exigirEncontrado(
    await tx.gedDocumento.update({ where: { id: input.documento_id }, data: { updated_at: new Date() }, select: { id: true, status: true, titulo: true } }),
    "Documento não encontrado.",
  );
  const ultima = await tx.gedVersaoDocumento.findFirst({ where: { documento_id: doc.id }, orderBy: { n: "desc" }, select: { n: true, selada: true } });
  const algumaSelada = ultima?.selada ?? false;
  if (!podeNovaVersao({ status: doc.status, ultimaSelada: algumaSelada }, input.origem)) {
    throw invalido("Documento assinado/selado não aceita novas versões. Crie um documento derivado.");
  }
  // Nova versão de CONTEÚDO invalida a solicitação de assinatura aberta (design §3, passo 1: o hash a assinar mudou):
  // cancela-a (documento volta a PUBLICADO, signatários pendentes são avisados). OCR/anonimização/selo não alteram o conteúdo assinado.
  if (ORIGENS_QUE_CANCELAM_ASSINATURA.includes(input.origem)) await cancelarSolicitacoesAbertas(tx, ctx, doc.id, "Documento alterado (nova versão).");
  if (input.derivada_de_id) {
    const base = await tx.gedVersaoDocumento.findFirst({ where: { id: input.derivada_de_id, documento_id: doc.id }, select: { id: true } });
    if (!base) throw invalido("Versão de origem inválida para este documento.");
  }

  const n = proximoNumeroVersao(ultima?.n);
  const storage_key = chaveGed(ctx.organizacao_id, { documentoId: doc.id, n, sha8: sha256.slice(0, 8), ext: extensaoDoMime(input.mime, input.nome_arquivo) });
  const upload = ORIGENS_COM_UPLOAD.includes(input.origem) ? { nome: input.nome_arquivo, contexto: "ged_documento", usuario_id: ctx.usuario.id, entidade_id: doc.id } : null;
  await salvarArquivoGed(ctx.organizacao_id, storage_key, input.arquivo, input.mime, upload);

  const html = input.origem === "EDITOR" ? (input.conteudo_html ?? null) : null;
  const versao = await tx.gedVersaoDocumento.create({
    data: {
      documento_id: doc.id,
      n,
      origem: input.origem,
      derivada_de_id: input.derivada_de_id ?? null,
      storage_key,
      nome_arquivo: input.nome_arquivo,
      mime: input.mime,
      tamanho: input.arquivo.length,
      sha256,
      paginas,
      conteudo_html: html,
      texto_status: html !== null ? "EXTRAIDO" : "PENDENTE",
      selada: input.selada ?? false,
      criado_por_id: ctx.usuario.id,
    } as Prisma.GedVersaoDocumentoUncheckedCreateInput,
    select: { id: true },
  });
  if (html !== null) {
    await tx.gedConteudoTexto.create({ data: { versao_id: versao.id, documento_id: doc.id, texto: htmlParaTexto(html), metodo: "EDITOR" } as Prisma.GedConteudoTextoUncheckedCreateInput });
  }
  await tx.gedDocumento.update({ where: { id: doc.id }, data: { versao_atual_id: versao.id } });
  await auditarGed(
    ctx,
    { acao: "GED_VERSAO_CRIADA", entidade: "ged_versao_documento", entidade_id: versao.id, depois: { documento_id: doc.id, n, origem: input.origem, sha256, tamanho: input.arquivo.length, selada: input.selada ?? false } },
    tx,
  );
  return { id: versao.id, n, sha256, storage_key };
}
