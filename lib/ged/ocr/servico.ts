// OCR do GED (fase 2): agendamento, execução e cota. Usado pelo worker (jobs/ged-ocr.ts), pela extração de texto (SEM_TEXTO →
// agenda OCR) e pelo "Reprocessar OCR". Tudo via gedDb(organizacao_id); nenhum SQL cru.
//
// Fluxo: versão-base (UPLOAD/SCAN) sem texto → ocr_status=PENDENTE → worker PROCESSANDO → ocrmypdf → NOVA versão origem=OCR
// (derivada_de_id = base; o scan original permanece, com o seu sha256) com o texto indexado (GedConteudoTexto metodo OCR) → base CONCLUIDO.
// OCR NÃO cancela solicitação de assinatura aberta (não altera o conteúdo – ver versoes.ts) e nunca roda em versão selada/assinada.
import type { GedStatusOcr, Prisma } from "@prisma/client";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../contratos";
import { gedDb, type GedDb } from "../db";
import { lerArquivoGed } from "../storage";
import { contarPaginasPdf, limparTexto, textoDoPdf, textoEscasso } from "../documentos/pdf-info";
import { criarVersao } from "../documentos/versoes";
import {
  avaliarCota,
  COTA_OCR_PADRAO_PAGINAS_MES,
  decidirOcr,
  ehImagemOcr,
  elegivelParaOcr,
  erroDeLimites,
  inicioDoMesBrasilia,
  limitesOcr,
  statusDaSaida,
  type AvaliacaoCota,
} from "./decisao";
import { executarOcr, ocrDisponivel } from "./executar";

export type ResultadoOcrAgora = GedStatusOcr | "IGNORADO";
const ID_NULO = "00000000-0000-0000-0000-000000000000";
/** PROCESSANDO há mais que isto = worker caiu; volta para PENDENTE. */
export const TRAVADO_APOS_MS = 30 * 60_000;

// ───────────── Cota ─────────────

/** Cota mensal do cliente (GedConfig; sem registro = padrão) e páginas já consumidas no mês corrente (versões OCR criadas). */
export async function cotaOcrDoMes(db: GedDb, agora: Date = new Date()): Promise<AvaliacaoCota> {
  const cfg = await db.gedConfig.findFirst({ select: { ocr_cota_paginas_mes: true } });
  const cota = cfg ? cfg.ocr_cota_paginas_mes : COTA_OCR_PADRAO_PAGINAS_MES;
  const soma = await db.gedVersaoDocumento.aggregate({ where: { origem: "OCR", created_at: { gte: inicioDoMesBrasilia(agora) } }, _sum: { paginas: true } });
  return avaliarCota({ cota, usadas: soma._sum.paginas ?? 0, paginas: 0 });
}

// ───────────── Agendamento ─────────────

/**
 * Marca a versão para OCR (ocr_status=PENDENTE) se ela é elegível. Sem `forcar`, só quando ainda não houve tentativa (ocr_status nulo).
 * Não executa nada: o worker (varredura) ou o disparo inline cuidam. Nunca lança.
 */
export async function agendarOcr(organizacaoId: string, versaoId: string, opc: { forcar?: boolean } = {}): Promise<"AGENDADO" | "IGNORADO"> {
  try {
    const db = gedDb(organizacaoId);
    const v = await db.gedVersaoDocumento.findUnique({ where: { id: versaoId }, select: { id: true, origem: true, selada: true, ocr_status: true, documento_id: true, documento: { select: { status: true } } } });
    if (!v) return "IGNORADO";
    if (!opc.forcar && v.ocr_status !== null) return "IGNORADO";
    if (opc.forcar && (v.ocr_status === "PENDENTE" || v.ocr_status === "PROCESSANDO" || v.ocr_status === "CONCLUIDO")) return "IGNORADO";
    const seladas = await db.gedVersaoDocumento.count({ where: { documento_id: v.documento_id, selada: true } });
    if (!elegivelParaOcr({ origem: v.origem, selada: v.selada, statusDocumento: v.documento.status, documentoTemVersaoSelada: seladas > 0 }).ok) return "IGNORADO";
    const r = await db.gedVersaoDocumento.updateMany({ where: { id: v.id, selada: false }, data: { ocr_status: "PENDENTE", ocr_mensagem: null } });
    return r.count > 0 ? "AGENDADO" : "IGNORADO";
  } catch (e) {
    console.error("[ged-ocr] agendar", e instanceof Error ? e.message : e);
    return "IGNORADO";
  }
}

/** Agenda o OCR de uma versão com base no texto extraído (chamado pela extração de texto). Dispara o OCR inline quando não há worker. */
export async function agendarOcrSeNecessario(organizacaoId: string, v: { id: string; mime: string; paginas: number | null }, texto: string | null): Promise<void> {
  if (!decidirOcr({ mime: v.mime, texto, paginas: v.paginas }).precisa) return;
  if ((await agendarOcr(organizacaoId, v.id)) === "AGENDADO") await iniciarOcrInline(organizacaoId, v.id);
}

/**
 * Sem worker no ar E com o binário disponível neste processo (ou GED_OCR_INLINE=true), roda o OCR em segundo plano no próprio web.
 * Caso contrário a versão fica PENDENTE para a varredura do worker (que pode ser dedicado: JOBS_FILAS=ged-ocr).
 */
export async function iniciarOcrInline(organizacaoId: string, versaoId: string): Promise<"worker" | "inline" | "pendente"> {
  try {
    let viaWorker = false;
    try {
      const { workerNoAr } = await import("@/lib/agente/ingestao");
      viaWorker = process.env.GED_OCR_INLINE !== "true" && (await workerNoAr());
    } catch {
      viaWorker = false;
    }
    if (viaWorker) return "worker";
    if (process.env.GED_OCR_INLINE !== "true" && !(await ocrDisponivel())) return "pendente";
    void ocrAgora(organizacaoId, versaoId).catch((e) => console.error("[ged-ocr] inline", e));
    return "inline";
  } catch {
    return "pendente";
  }
}

// ───────────── Execução ─────────────

async function finalizar(db: GedDb, id: string, status: GedStatusOcr | null, mensagem: string | null) {
  await db.gedVersaoDocumento.updateMany({ where: { id, selada: false }, data: { ocr_status: status, ocr_mensagem: mensagem } });
}

/** Quem figura como autor da versão OCR: o autor da versão-base se ainda tem acesso ao GED; senão um GED_ADMIN ativo do cliente. */
async function ctxDoOcr(organizacaoId: string, autorId: string): Promise<CtxGed | null> {
  const { ctxGedPorUsuarioId } = await import("../escopo");
  const direto = await ctxGedPorUsuarioId(autorId);
  if (direto && direto.organizacao_id === organizacaoId) return direto;
  const admins = await gedDb(organizacaoId).gedMembro.findMany({ where: { papel: "GED_ADMIN", ativo: true }, select: { usuario_id: true }, take: 5 });
  for (const a of admins) {
    const c = await ctxGedPorUsuarioId(a.usuario_id);
    if (c && c.organizacao_id === organizacaoId) return c;
  }
  return null;
}

const nomeComoPdf = (nome: string) => (/\.pdf$/i.test(nome) ? nome : `${nome.replace(/\.[A-Za-z0-9]{1,5}$/, "")}.pdf`);

/**
 * Executa o OCR de UMA versão PENDENTE (reivindica atomicamente: duas execuções simultâneas não duplicam). Nunca lança;
 * o resultado fica em `ocr_status`. Idempotente: versão que já não está PENDENTE → IGNORADO.
 */
export async function ocrAgora(organizacaoId: string, versaoId: string): Promise<ResultadoOcrAgora> {
  const db = gedDb(organizacaoId);
  const claim = await db.gedVersaoDocumento.updateMany({ where: { id: versaoId, ocr_status: "PENDENTE", selada: false }, data: { ocr_status: "PROCESSANDO" } });
  if (claim.count !== 1) return "IGNORADO";
  try {
    const v = await db.gedVersaoDocumento.findUnique({
      where: { id: versaoId },
      select: { id: true, documento_id: true, origem: true, selada: true, storage_key: true, nome_arquivo: true, mime: true, tamanho: true, paginas: true, sha256: true, criado_por_id: true, documento: { select: { status: true, versao_atual_id: true, numero: true } } },
    });
    if (!v) return "IGNORADO";
    const seladas = await db.gedVersaoDocumento.count({ where: { documento_id: v.documento_id, selada: true } });
    const el = elegivelParaOcr({ origem: v.origem, selada: v.selada, statusDocumento: v.documento.status, documentoTemVersaoSelada: seladas > 0 });
    if (!el.ok) {
      await finalizar(db, v.id, null, null);
      return "IGNORADO";
    }
    const ctx = await ctxDoOcr(organizacaoId, v.criado_por_id);
    if (!ctx) {
      await finalizar(db, v.id, "ERRO", "Nenhum usuário ativo para registrar a versão de OCR.");
      return "ERRO";
    }
    const falha = async (status: GedStatusOcr, mensagem: string, extra: Record<string, unknown> = {}): Promise<GedStatusOcr> => {
      await db.$transaction(async (tx) => {
        await tx.gedVersaoDocumento.updateMany({ where: { id: v.id, selada: false }, data: { ocr_status: status, ocr_mensagem: mensagem } });
        await auditarGed(ctx, { acao: status === "COTA_EXCEDIDA" ? "GED_OCR_COTA_EXCEDIDA" : "GED_OCR_FALHA", entidade: "ged_versao_documento", entidade_id: v.id, depois: { documento_id: v.documento_id, status, mensagem, automatico: true, ...extra } }, tx);
      });
      return status;
    };

    const limite = erroDeLimites({ paginas: v.paginas, tamanho: v.tamanho }, limitesOcr());
    if (limite) return await falha("ERRO", limite);

    const arquivo = await lerArquivoGed(organizacaoId, v.storage_key);
    const paginas = v.paginas ?? (ehImagemOcr(v.mime) ? 1 : await contarPaginasPdf(arquivo)) ?? 1;
    const cota = avaliarCota({ ...(await cotaOcrDoMes(db)), paginas });
    if (!cota.ok) {
      const msg = cota.cota === 0 ? "OCR desligado para este cliente (cota mensal igual a zero)." : `Cota mensal de OCR excedida (${cota.usadas} de ${cota.cota} páginas usadas; este arquivo tem ${paginas}).`;
      return await falha("COTA_EXCEDIDA", msg, { paginas, cota: cota.cota, usadas: cota.usadas });
    }
    if (!(await ocrDisponivel())) return await falha("OCR_INDISPONIVEL", statusDaSaida({ tipo: "INDISPONIVEL", detalhe: "" }).mensagem!);

    const r = await executarOcr(arquivo, v.mime);
    if (r.saida.tipo !== "OK" || !r.arquivo) {
      const s = statusDaSaida(r.saida);
      if (r.saida.tipo !== "INDISPONIVEL") console.error(`[ged-ocr] versão ${versaoId}:`, r.saida.tipo, "detalhe" in r.saida ? r.saida.detalhe : "");
      return await falha(s.status, s.mensagem ?? "Falha no OCR.");
    }
    const pdfOcr = r.arquivo;
    const texto = limparTexto(await textoDoPdf(pdfOcr));
    const paginasOcr = (await contarPaginasPdf(pdfOcr)) ?? paginas;
    if (textoEscasso(texto, paginasOcr)) return await falha("ERRO", "O OCR não reconheceu texto no arquivo (imagem ilegível ou sem texto).");

    const concluido = await db.$transaction(
      async (tx) => {
        // trava o documento e confere que a base ainda é a versão atual e que ele não foi assinado enquanto o OCR rodava
        const doc = await tx.gedDocumento.update({ where: { id: v.documento_id }, data: { updated_at: new Date() }, select: { status: true, versao_atual_id: true } });
        const selada = await tx.gedVersaoDocumento.count({ where: { documento_id: v.documento_id, selada: true } });
        if (doc.versao_atual_id !== v.id || doc.status === "ASSINADO" || doc.status === "ARQUIVADO" || selada > 0) return null;
        const nova = await criarVersao(tx, ctx, { documento_id: v.documento_id, origem: "OCR", arquivo: pdfOcr, nome_arquivo: nomeComoPdf(v.nome_arquivo), mime: "application/pdf", derivada_de_id: v.id });
        await tx.gedConteudoTexto.create({ data: { versao_id: nova.id, documento_id: v.documento_id, texto, metodo: "OCR" } as Prisma.GedConteudoTextoUncheckedCreateInput });
        await tx.gedVersaoDocumento.update({ where: { id: nova.id }, data: { texto_status: "EXTRAIDO" } });
        await tx.gedVersaoDocumento.update({ where: { id: v.id }, data: { ocr_status: "CONCLUIDO", ocr_mensagem: null } });
        await auditarGed(
          ctx,
          { acao: "GED_OCR_CONCLUIDO", entidade: "ged_versao_documento", entidade_id: nova.id, depois: { documento_id: v.documento_id, versao_origem_id: v.id, sha256_origem: v.sha256, versao_ocr_n: nova.n, sha256_ocr: nova.sha256, paginas: paginasOcr, automatico: true } },
          tx,
        );
        return nova.id;
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
    if (!concluido) {
      await finalizar(db, v.id, null, null);
      return "IGNORADO";
    }
    return "CONCLUIDO";
  } catch (e) {
    console.error(`[ged-ocr] versão ${versaoId} falhou:`, e instanceof Error ? e.message : e);
    await finalizar(db, versaoId, "ERRO", "Falha inesperada ao processar o OCR.").catch(() => {});
    return "ERRO";
  }
}

// ───────────── Varredura do worker ─────────────

export type VersaoOcrPendente = { id: string; organizacao_id: string };

/** Versões com OCR PENDENTE de TODOS os clientes com GED (e devolve a PENDENTE as PROCESSANDO travadas). */
export async function versoesOcrPendentes(limite = 20, idadeMinimaMs = 5000): Promise<VersaoOcrPendente[]> {
  const orgs = await gedDb(ID_NULO).organizacao.findMany({ where: { status: "ATIVO", modulos: { has: "GED" } }, select: { id: true } });
  const corte = new Date(Date.now() - idadeMinimaMs);
  const travadas = new Date(Date.now() - TRAVADO_APOS_MS);
  const out: VersaoOcrPendente[] = [];
  for (const o of orgs) {
    const db = gedDb(o.id);
    await db.gedVersaoDocumento.updateMany({ where: { ocr_status: "PROCESSANDO", updated_at: { lt: travadas }, selada: false }, data: { ocr_status: "PENDENTE" } });
    if (out.length >= limite) continue;
    out.push(...(await db.gedVersaoDocumento.findMany({ where: { ocr_status: "PENDENTE", updated_at: { lt: corte } }, orderBy: { created_at: "asc" }, take: limite - out.length, select: { id: true, organizacao_id: true } })));
  }
  return out;
}
