// Trechos (snippets) de resultados da busca por conteúdo. PURO.
// O Postgres gera o trecho sobre o texto SEM acentos (é o que a consulta indexa); aqui os acentos originais são
// reaplicados quando o alinhamento é verificável, e o destaque vira uma lista de trechos (sem HTML: o front escapa).
export const MARCA_INI = "⟦";
export const MARCA_FIM = "⟧";

export type TrechoSnippet = { texto: string; destaque: boolean };

export const removerAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Quebra "texto ⟦achado⟧ texto" em trechos. */
export function dividirMarcado(marcado: string): TrechoSnippet[] {
  const out: TrechoSnippet[] = [];
  let destaque = false;
  let atual = "";
  for (const ch of marcado) {
    if (ch === MARCA_INI || ch === MARCA_FIM) {
      if (atual) out.push({ texto: atual, destaque });
      atual = "";
      destaque = ch === MARCA_INI;
    } else atual += ch;
  }
  if (atual) out.push({ texto: atual, destaque });
  return out;
}

/**
 * `marcado`: trecho do texto sem acentos com ⟦ ⟧ em volta dos achados. `original`: o mesmo trecho no texto com acentos
 * (pode ser null). Usa o original só se, sem acentos, for idêntico ao trecho (senão mantém o sem acentos).
 */
export function montarTrechos(marcado: string, original: string | null): TrechoSnippet[] {
  const base = dividirMarcado(marcado);
  const plano = base.map((t) => t.texto).join("");
  const usar = original !== null && original.length === plano.length && removerAcentos(original).toLowerCase() === plano.toLowerCase();
  let pos = 0;
  const trechos = base.map((t) => {
    const texto = usar ? original!.slice(pos, pos + t.texto.length) : t.texto;
    pos += t.texto.length;
    return { texto: texto.replace(/\s+/g, " "), destaque: t.destaque };
  });
  if (trechos.length) trechos[0].texto = trechos[0].texto.replace(/^\s+/, "");
  return trechos;
}
