// Anonimização – SOMENTE as regras de marcação (motor de redação/detecção é futuro; docs/ged-design.md §7). PURO.
//   - `contem_dados_pessoais` é uma marca manual (ANONIMIZAR, ou EDITAR para a marca);
//   - com a marca ligada e anonimização ainda não feita → anonimizacao_status=PENDENTE e o documento NUNCA fica PUBLICO
//     (CHECK do banco: PENDENTE exige sensibilidade ≠ PUBLICO) – o app rebaixa para RESTRITO em vez de falhar;
//   - exposição pública: original com dados pessoais (ou anonimização PENDENTE/ANONIMIZADA) nunca é público; só o derivado
//     anonimizado (documento_original_id) com sensibilidade PUBLICO – `whereExposicaoPublica()`.
import type { GedAnonimizacao, GedSensibilidade, Prisma } from "@prisma/client";

export type EstadoLgpd = {
  sensibilidade: GedSensibilidade;
  contem_dados_pessoais: boolean;
  anonimizacao_status: GedAnonimizacao;
};

export type ResultadoMarcaLgpd = EstadoLgpd & {
  /** A sensibilidade foi reduzida de PUBLICO para RESTRITO por causa da marca. */
  sensibilidade_rebaixada: boolean;
};

/** Aplica a marca "contém dados pessoais" respeitando o CHECK do banco. */
export function aplicarMarcaDadosPessoais(atual: EstadoLgpd, contem: boolean): ResultadoMarcaLgpd {
  if (contem) {
    const anonimizacao_status: GedAnonimizacao = atual.anonimizacao_status === "ANONIMIZADA" ? "ANONIMIZADA" : "PENDENTE";
    const rebaixa = anonimizacao_status === "PENDENTE" && atual.sensibilidade === "PUBLICO";
    return { contem_dados_pessoais: true, anonimizacao_status, sensibilidade: rebaixa ? "RESTRITO" : atual.sensibilidade, sensibilidade_rebaixada: rebaixa };
  }
  return {
    contem_dados_pessoais: false,
    anonimizacao_status: atual.anonimizacao_status === "PENDENTE" ? "NAO_NECESSARIA" : atual.anonimizacao_status,
    sensibilidade: atual.sensibilidade,
    sensibilidade_rebaixada: false,
  };
}

/**
 * Mensagem de erro se `nova` sensibilidade não puder ser aplicada ao documento (null = permitida).
 * Original com dados pessoais não pode ser PUBLICO; o derivado anonimizado (documento_original_id) pode.
 */
export function erroSensibilidade(nova: GedSensibilidade, doc: EstadoLgpd & { documento_original_id?: string | null }): string | null {
  if (nova !== "PUBLICO") return null;
  if (doc.anonimizacao_status === "PENDENTE") return "Documento com anonimização pendente não pode ser público.";
  if (doc.contem_dados_pessoais && !doc.documento_original_id) return "Documento que contém dados pessoais não pode ser público; use a versão anonimizada.";
  return null;
}

export type DocExposicao = EstadoLgpd & { status: string; excluido_em: Date | null; documento_original_id: string | null };

const STATUS_PUBLICAVEIS = ["PUBLICADO", "ASSINADO"] as const;

/** Espelho em JS de `whereExposicaoPublica` (testes e conferência de uma linha já carregada). */
export function podeExporPublicamente(d: DocExposicao): boolean {
  if (d.excluido_em !== null || d.sensibilidade !== "PUBLICO") return false;
  if (!(STATUS_PUBLICAVEIS as readonly string[]).includes(d.status)) return false;
  if (d.contem_dados_pessoais) return false;
  if (d.documento_original_id) return true; // derivado anonimizado
  return d.anonimizacao_status === "NAO_NECESSARIA"; // original sem dados pessoais
}

/** Filtro de documentos que o portal público (futuro) pode expor. Combine com o escopo do cliente (ctx.db). */
export function whereExposicaoPublica(): Prisma.GedDocumentoWhereInput {
  return {
    excluido_em: null,
    sensibilidade: "PUBLICO",
    status: { in: [...STATUS_PUBLICAVEIS] },
    contem_dados_pessoais: false,
    OR: [{ documento_original_id: { not: null } }, { documento_original_id: null, anonimizacao_status: "NAO_NECESSARIA" }],
  };
}

export const ROTULO_ANONIMIZACAO: Record<GedAnonimizacao, string> = {
  NAO_NECESSARIA: "Anonimização não necessária",
  PENDENTE: "Anonimização pendente",
  ANONIMIZADA: "Anonimizado",
};
