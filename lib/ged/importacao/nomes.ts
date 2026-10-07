// Funções puras de nomes da importação (testadas em tests/unit/ged-importacao-zip.test.ts).

/** Título do documento a partir do nome do arquivo: sem ".pdf", `_` vira espaço, mínimo de 3 e máximo de 250 caracteres. */
export function tituloDoArquivo(nome: string): string {
  const t = nome.replace(/\.pdf$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, 250).trim();
  return t.length >= 3 ? t : `Documento ${t || "sem título"}`.slice(0, 250);
}
