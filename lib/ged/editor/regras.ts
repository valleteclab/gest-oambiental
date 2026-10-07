// Regras PURAS do editor (sem banco) – tests/unit/ged-editor.test.ts.
import type { GedOrigemVersao, GedStatusDocumento } from "@prisma/client";

export type EstadoEditor =
  /** Documento em edição no editor: autosave e finalizar. */
  | { tipo: "RASCUNHO" }
  /** Documento já finalizado, criado no editor: "Editar" cria nova versão (volta a RASCUNHO). */
  | { tipo: "REABRIR" }
  /** Não editável no editor; `motivo` é mostrado ao usuário. */
  | { tipo: "BLOQUEADO"; motivo: string };

/**
 * Estado do documento diante do editor.
 * RASCUNHO + versão atual EDITOR = em edição (a finalização sempre muda o status para PUBLICADO).
 * `temVersaoEditor`: existe alguma versão origem EDITOR com HTML (necessária para reabrir).
 */
export function estadoDoEditor(d: { status: GedStatusDocumento; versao_atual_origem: GedOrigemVersao | null; versao_atual_selada: boolean; temVersaoEditor: boolean }): EstadoEditor {
  if (d.versao_atual_selada || d.status === "ASSINADO") return { tipo: "BLOQUEADO", motivo: "Documento assinado/selado não pode ser editado. Crie um novo documento a partir dele." };
  if (d.status === "EM_ASSINATURA") return { tipo: "BLOQUEADO", motivo: "Documento em assinatura: conclua ou cancele a solicitação de assinatura antes de editar." };
  if (d.status === "ARQUIVADO") return { tipo: "BLOQUEADO", motivo: "Documento arquivado não pode ser editado." };
  if (d.status === "RASCUNHO" && d.versao_atual_origem === "EDITOR") return { tipo: "RASCUNHO" };
  if (!d.temVersaoEditor) return { tipo: "BLOQUEADO", motivo: "Este documento foi enviado como arquivo e não foi criado no editor de texto." };
  return { tipo: "REABRIR" };
}

/** Nome do arquivo PDF a partir do título (ASCII seguro). */
export function nomeArquivoPdf(titulo: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "documento"}.pdf`;
}

/** Texto visível do HTML tem conteúdo? (impede finalizar documento vazio) */
export function htmlTemConteudo(textoPlano: string): boolean {
  return textoPlano.replace(/\s+/g, "").length > 0;
}

export const MAX_TITULO = 200;
export const MAX_REMETENTE = 200;
