// CSV dos logs (RFC 4180 + proteção contra injeção de fórmula em planilhas). Funções puras.
const GATILHOS_FORMULA = /^[=+\-@\t\r]/;

/** Escapa uma célula: aspas duplicadas, campo entre aspas se necessário e apóstrofo antes de gatilhos de fórmula. */
export function celulaCsv(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (GATILHOS_FORMULA.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Separador ";" (padrão do Excel em pt-BR). */
export const linhaCsv = (celulas: unknown[]) => `${celulas.map(celulaCsv).join(";")}\r\n`;

/** BOM UTF-8 para o Excel reconhecer acentos. */
export const BOM_UTF8 = "﻿";

export function montarCsv(cabecalho: string[], linhas: unknown[][]): string {
  return BOM_UTF8 + linhaCsv(cabecalho) + linhas.map(linhaCsv).join("");
}
