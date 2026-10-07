// Extração de texto dos PDFs do GED (docs/ged-design.md §6, fase 1): `pdftotext -layout` (poppler) → GedConteudoTexto.
//   - texto útil < ~25 caracteres/página → SEM_TEXTO (PDF escaneado; candidato a OCR na fase 2);
//   - sucesso → GedConteudoTexto (metodo PDF_TEXTO) + texto_status EXTRAIDO; falha (após tentativas) → ERRO;
//   - o job (jobs/ged-texto.ts) e o upload (sem worker no ar) usam as mesmas funções.
// Sem tenant em jobs: a descoberta de versões pendentes lista as organizações com o módulo GED (modelo que não é Ged*) e
// consulta cada uma com gedDb(organizacao_id) – nenhum SQL cru fora de lib/ged/busca.ts/db.ts.
import type { Prisma } from "@prisma/client";
import { gedDb } from "../db";
import { lerArquivoGed } from "../storage";
import { contarPaginasPdf, limparTexto, textoDoPdf, textoEscasso } from "./pdf-info";

export type ResultadoExtracao = "EXTRAIDO" | "SEM_TEXTO" | "ERRO" | "IGNORADO";
export const TENTATIVAS_EXTRACAO = 2;
const ID_NULO = "00000000-0000-0000-0000-000000000000";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extrai e indexa o texto de UMA versão. Por padrão só processa versões PENDENTE (`forcar` reprocessa ERRO/SEM_TEXTO).
 * Nunca lança: o resultado fica em `texto_status`.
 */
export async function extrairTextoAgora(organizacaoId: string, versaoId: string, opc: { forcar?: boolean } = {}): Promise<ResultadoExtracao> {
  const db = gedDb(organizacaoId);
  const v = await db.gedVersaoDocumento.findUnique({ where: { id: versaoId }, select: { id: true, documento_id: true, storage_key: true, mime: true, paginas: true, texto_status: true } });
  if (!v) return "IGNORADO";
  if (!opc.forcar && v.texto_status !== "PENDENTE") return "IGNORADO";
  if (!/pdf/i.test(v.mime)) {
    await db.gedVersaoDocumento.update({ where: { id: v.id }, data: { texto_status: "SEM_TEXTO" } });
    return "SEM_TEXTO";
  }
  let ultimoErro: unknown;
  for (let t = 1; t <= TENTATIVAS_EXTRACAO; t++) {
    try {
      const arquivo = await lerArquivoGed(organizacaoId, v.storage_key);
      const texto = limparTexto(await textoDoPdf(arquivo));
      const paginas = v.paginas ?? (await contarPaginasPdf(arquivo));
      if (textoEscasso(texto, paginas)) {
        await db.gedVersaoDocumento.update({ where: { id: v.id }, data: { texto_status: "SEM_TEXTO", ...(v.paginas == null && paginas ? { paginas } : {}) } });
        return "SEM_TEXTO";
      }
      await db.$transaction(async (tx) => {
        await tx.gedConteudoTexto.upsert({
          where: { versao_id: v.id },
          create: { versao_id: v.id, documento_id: v.documento_id, texto, metodo: "PDF_TEXTO" } as Prisma.GedConteudoTextoUncheckedCreateInput,
          update: { texto, metodo: "PDF_TEXTO" },
        });
        await tx.gedVersaoDocumento.update({ where: { id: v.id }, data: { texto_status: "EXTRAIDO", ...(v.paginas == null && paginas ? { paginas } : {}) } });
      });
      return "EXTRAIDO";
    } catch (e) {
      ultimoErro = e;
      if (t < TENTATIVAS_EXTRACAO) await dormir(1000 * t);
    }
  }
  console.error(`[ged-texto] versão ${versaoId} falhou:`, ultimoErro instanceof Error ? ultimoErro.message : ultimoErro);
  await db.gedVersaoDocumento.update({ where: { id: v.id }, data: { texto_status: "ERRO" } }).catch(() => {});
  return "ERRO";
}

/** Marca a versão para nova tentativa (ERRO/SEM_TEXTO → PENDENTE). O job a pega na próxima varredura. */
export async function reprocessarTexto(organizacaoId: string, versaoId: string): Promise<boolean> {
  const r = await gedDb(organizacaoId).gedVersaoDocumento.updateMany({ where: { id: versaoId, texto_status: { in: ["ERRO", "SEM_TEXTO"] } }, data: { texto_status: "PENDENTE" } });
  return r.count > 0;
}

export type VersaoPendente = { id: string; organizacao_id: string };

/** Versões com texto PENDENTE em TODOS os clientes com GED (para o worker). Ignora as muito recentes (o upload já cuida delas). */
export async function versoesPendentes(limite = 50, idadeMinimaMs = 5000): Promise<VersaoPendente[]> {
  const orgs = await gedDb(ID_NULO).organizacao.findMany({ where: { modulos: { has: "GED" } }, select: { id: true } });
  const corte = new Date(Date.now() - idadeMinimaMs);
  const out: VersaoPendente[] = [];
  for (const o of orgs) {
    if (out.length >= limite) break;
    const l = await gedDb(o.id).gedVersaoDocumento.findMany({
      where: { texto_status: "PENDENTE", created_at: { lt: corte } },
      orderBy: { created_at: "asc" },
      take: limite - out.length,
      select: { id: true, organizacao_id: true },
    });
    out.push(...l);
  }
  return out;
}

/**
 * Chamar DEPOIS do commit do upload: sem worker no ar, extrai em segundo plano no próprio processo web
 * (mesmo critério de lib/export/lib/agente: application_name das conexões). Com worker, a varredura de 15 s cuida.
 */
export async function iniciarExtracaoAposUpload(organizacaoId: string, versaoId: string): Promise<"worker" | "inline"> {
  let viaWorker = false;
  try {
    const { workerNoAr } = await import("@/lib/agente/ingestao");
    viaWorker = process.env.GED_TEXTO_INLINE !== "true" && (await workerNoAr());
  } catch {
    viaWorker = false;
  }
  if (!viaWorker) void extrairTextoAgora(organizacaoId, versaoId).catch((e) => console.error("[ged-texto] inline", e));
  return viaWorker ? "worker" : "inline";
}
