// OCR do GED (docs/ged-design.md §6, fase 2) – regras PURAS (sem banco, sem processo externo): testadas em tests/unit/ged-ocr.test.ts.
import type { GedOrigemVersao, GedStatusOcr } from "@prisma/client";

/** Texto útil mínimo por página; abaixo disso a página é tratada como imagem (mesmo critério de pdf-info.textoEscasso). */
export const MIN_CARACTERES_POR_PAGINA = 25;
/** Cota mensal padrão de páginas de OCR por cliente (GedConfig.ocr_cota_paginas_mes). */
export const COTA_OCR_PADRAO_PAGINAS_MES = 5000;
export const LIMITE_PAGINAS_OCR_PADRAO = 300;
export const LIMITE_BYTES_OCR_PADRAO = 25 * 1024 * 1024;

export const MIMES_IMAGEM_OCR: readonly string[] = ["image/png", "image/jpeg", "image/jpg", "image/tiff", "image/x-tiff"];

export const ehImagemOcr = (mime: string) => MIMES_IMAGEM_OCR.includes((mime ?? "").toLowerCase().split(";")[0].trim());
export const ehPdf = (mime: string) => /pdf/i.test(mime ?? "");

/** Texto útil (sem espaços) de uma página. */
const uteis = (t: string) => t.replace(/\s+/g, "").length;

/** Páginas do texto do `pdftotext` (separadas por form feed `\f`; a última quebra é só o terminador). */
export function paginasDoTexto(texto: string): string[] {
  const p = texto.split("\f");
  if (p.length > 1 && p[p.length - 1].trim() === "") p.pop();
  return p;
}

export type DecisaoOcr = { precisa: boolean; motivo: "IMAGEM" | "SEM_TEXTO" | "PAGINAS_SEM_TEXTO" | "TEM_TEXTO" | "TIPO_NAO_SUPORTADO" };

/**
 * Esta versão precisa de OCR?
 *  - imagem PNG/JPG/TIFF: sempre (o resultado é um PDF pesquisável);
 *  - PDF: o texto extraído (`pdftotext`) é escasso no total (< ~25 caracteres/página) OU metade ou mais das páginas
 *    não tem texto útil (PDF misto: capa digital + miolo escaneado). `--skip-text` do ocrmypdf preserva as páginas com texto;
 *  - texto === null (extração falhou/indisponível) → não decide por OCR (a extração tenta de novo).
 */
export function decidirOcr(v: { mime: string; texto: string | null; paginas: number | null }): DecisaoOcr {
  if (ehImagemOcr(v.mime)) return { precisa: true, motivo: "IMAGEM" };
  if (!ehPdf(v.mime)) return { precisa: false, motivo: "TIPO_NAO_SUPORTADO" };
  if (v.texto === null) return { precisa: false, motivo: "TEM_TEXTO" };
  const paginas = Math.max(1, v.paginas ?? paginasDoTexto(v.texto).length);
  if (uteis(v.texto) < MIN_CARACTERES_POR_PAGINA * paginas) return { precisa: true, motivo: "SEM_TEXTO" };
  const porPagina = paginasDoTexto(v.texto);
  // só confia na divisão por página se ela bate com a contagem de páginas do PDF
  if (porPagina.length === paginas && paginas > 1) {
    const vazias = porPagina.filter((p) => uteis(p) < MIN_CARACTERES_POR_PAGINA).length;
    if (vazias * 2 >= paginas) return { precisa: true, motivo: "PAGINAS_SEM_TEXTO" };
  }
  return { precisa: false, motivo: "TEM_TEXTO" };
}

/** Origens de versão que podem ser submetidas ao OCR: só arquivo de pessoa. OCR/SELO/ANONIMIZACAO/EDITOR nunca (nem em laço). */
export const ORIGENS_ELEGIVEIS_OCR: readonly GedOrigemVersao[] = ["UPLOAD", "SCAN"];

/**
 * A versão pode receber OCR? Nunca em versão selada, documento ASSINADO (ou com versão selada), arquivado, ou origem não elegível.
 * (O trigger do banco já impede alterar versão selada; esta regra evita sequer tentar.)
 */
export function elegivelParaOcr(e: { origem: GedOrigemVersao; selada: boolean; statusDocumento: string; documentoTemVersaoSelada: boolean }): { ok: true } | { ok: false; motivo: string } {
  if (!ORIGENS_ELEGIVEIS_OCR.includes(e.origem)) return { ok: false, motivo: "Esta versão não é um arquivo enviado (OCR só se aplica a uploads e digitalizações)." };
  if (e.selada || e.documentoTemVersaoSelada || e.statusDocumento === "ASSINADO") return { ok: false, motivo: "Documento assinado/selado não passa por OCR." };
  if (e.statusDocumento === "ARQUIVADO") return { ok: false, motivo: "Restaure o documento antes de aplicar OCR." };
  return { ok: true };
}

export type LimitesOcr = { max_paginas: number; max_bytes: number };

export function limitesOcr(env: Record<string, string | undefined> = process.env): LimitesOcr {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { max_paginas: n(env.GED_OCR_MAX_PAGINAS, LIMITE_PAGINAS_OCR_PADRAO), max_bytes: n(env.GED_OCR_MAX_MB, LIMITE_BYTES_OCR_PADRAO / 1024 / 1024) * 1024 * 1024 };
}

/** Confere tamanho e páginas contra os limites; devolve a mensagem de recusa (ou null). */
export function erroDeLimites(v: { paginas: number | null; tamanho: number }, l: LimitesOcr): string | null {
  if (v.tamanho > l.max_bytes) return `Arquivo acima do limite de OCR (${Math.round(l.max_bytes / 1024 / 1024)} MB).`;
  if (v.paginas !== null && v.paginas > l.max_paginas) return `Documento com mais de ${l.max_paginas} páginas (limite do OCR).`;
  return null;
}

export type AvaliacaoCota = { ok: boolean; cota: number | null; usadas: number; restantes: number | null };

/** Cota mensal de páginas: `cota` null = sem limite; 0 = OCR desligado para o cliente. */
export function avaliarCota(e: { cota: number | null; usadas: number; paginas: number }): AvaliacaoCota {
  if (e.cota === null) return { ok: true, cota: null, usadas: e.usadas, restantes: null };
  const restantes = Math.max(0, e.cota - e.usadas);
  return { ok: e.cota > 0 && e.paginas <= restantes, cota: e.cota, usadas: e.usadas, restantes };
}

/** Início do mês corrente no fuso de Brasília (UTC-3, sem horário de verão) – janela da cota. */
export function inicioDoMesBrasilia(agora: Date = new Date()): Date {
  const local = new Date(agora.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 3, 0, 0));
}

// ───────────── Estado visível ─────────────

export type ApresentacaoOcr = { rotulo: string; cor: "azul" | "amarelo" | "verde" | "cinza" | "vermelho"; descricao: string };

/** Mapeamento do estado do OCR para o rótulo exibido na UI (Pendente / Processando / Concluído / Indisponível / Cota excedida). */
export function apresentacaoOcr(status: GedStatusOcr): ApresentacaoOcr {
  switch (status) {
    case "PENDENTE":
      return { rotulo: "OCR pendente", cor: "azul", descricao: "Na fila para reconhecimento de texto." };
    case "PROCESSANDO":
      return { rotulo: "OCR processando", cor: "azul", descricao: "Reconhecendo o texto do documento digitalizado." };
    case "CONCLUIDO":
      return { rotulo: "OCR concluído", cor: "verde", descricao: "Texto reconhecido; o documento é pesquisável (nova versão de OCR)." };
    case "OCR_INDISPONIVEL":
      return { rotulo: "OCR indisponível", cor: "cinza", descricao: "O serviço de OCR não está disponível neste ambiente. Tente reprocessar mais tarde." };
    case "COTA_EXCEDIDA":
      return { rotulo: "OCR: cota excedida", cor: "amarelo", descricao: "A cota mensal de páginas de OCR do cliente foi atingida." };
    case "ERRO":
      return { rotulo: "OCR falhou", cor: "vermelho", descricao: "Não foi possível reconhecer o texto deste arquivo." };
  }
}

/** Estados dos quais o administrador/gestor pode pedir novo OCR. */
export const STATUS_OCR_REPROCESSAVEIS: readonly (GedStatusOcr | null)[] = ["OCR_INDISPONIVEL", "COTA_EXCEDIDA", "ERRO", null];

export type SaidaOcr =
  | { tipo: "OK" }
  | { tipo: "INDISPONIVEL"; detalhe: string }
  | { tipo: "TEMPO_ESGOTADO" }
  | { tipo: "FALHA"; detalhe: string };

/** Interpreta o resultado do processo `ocrmypdf` (código de saída, erro de spawn, estouro de tempo). */
export function classificarSaidaOcr(r: { codigo: number | null; sinal?: string | null; erroSpawn?: string | null; tempoEsgotado?: boolean; stderr?: string }): SaidaOcr {
  if (r.erroSpawn) return /ENOENT|EACCES/.test(r.erroSpawn) ? { tipo: "INDISPONIVEL", detalhe: r.erroSpawn } : { tipo: "FALHA", detalhe: r.erroSpawn };
  if (r.tempoEsgotado) return { tipo: "TEMPO_ESGOTADO" };
  if (r.codigo === 0) return { tipo: "OK" };
  // 127 = comando não encontrado (wrapper/shell); demais códigos do ocrmypdf: 1 uso, 2 entrada inválida, 3 dependência ausente, 4 saída inválida, 6 já tem OCR, 7 arquivo criptografado, 9 ghostscript…
  if (r.codigo === 127 || r.codigo === 3) return { tipo: "INDISPONIVEL", detalhe: (r.stderr ?? "").trim().slice(0, 300) || `código ${r.codigo}` };
  return { tipo: "FALHA", detalhe: (r.stderr ?? "").trim().slice(-300) || `código ${r.codigo ?? r.sinal ?? "?"}` };
}

/** Mensagem curta exibida na UI para cada saída que não é sucesso (sem vazar caminho de arquivo). */
export function statusDaSaida(s: SaidaOcr): { status: GedStatusOcr; mensagem: string | null } {
  switch (s.tipo) {
    case "OK":
      return { status: "CONCLUIDO", mensagem: null };
    case "INDISPONIVEL":
      return { status: "OCR_INDISPONIVEL", mensagem: "ocrmypdf não encontrado ou incompleto neste ambiente." };
    case "TEMPO_ESGOTADO":
      return { status: "ERRO", mensagem: "Tempo limite do OCR excedido." };
    case "FALHA":
      return { status: "ERRO", mensagem: "Falha ao processar o arquivo no OCR." };
  }
}

export const PAPEIS_QUE_REPROCESSAM_OCR = ["GED_ADMIN", "GED_GESTOR"] as const;
export const podeReprocessarOcrPapel = (papel: string) => (PAPEIS_QUE_REPROCESSAM_OCR as readonly string[]).includes(papel);

/** A versão (atual do documento) admite um novo pedido de OCR? (versão OCR já é o resultado; selada/assinada não se aplica) */
export function ocrReprocessavel(v: { origem: GedOrigemVersao; selada: boolean; ocr_status: GedStatusOcr | null; texto_status: string }, statusDocumento: string): boolean {
  if (v.selada || statusDocumento === "ASSINADO" || statusDocumento === "ARQUIVADO") return false;
  if (!ORIGENS_ELEGIVEIS_OCR.includes(v.origem)) return false;
  if (v.ocr_status === null) return v.texto_status === "SEM_TEXTO" || v.texto_status === "OCR_PENDENTE"; // legado: scan indexado antes da fase 2
  return STATUS_OCR_REPROCESSAVEIS.includes(v.ocr_status);
}
