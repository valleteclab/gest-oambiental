// Sanitizador do HTML do editor (TipTap) – lista branca estrita, SEM alterar lib/documentos/render.ts.
// Estende a lista de lib/documentos/render.ts com o que o editor produz: tabelas com colspan/rowspan, alinhamento
// (style="text-align:…" validado) e links (somente http/https/mailto, sempre com rel seguro). Remove scripts, estilos,
// imagens, iframes, formulários, atributos de evento, `style` arbitrário e URLs perigosas (javascript:, data:, vbscript:).
// Funciona por tokenização: o que não é uma tag permitida vira TEXTO escapado (nenhum "<" solto sobrevive).
import { esc } from "@/lib/documentos/render";

const TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "hr", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "a", "span", "div", "pre", "code", "sub", "sup", "mark",
]);
const VAZIAS = new Set(["br", "hr", "col"]);
/** Elementos cujo CONTEÚDO também é descartado. */
const DESCARTA_COM_CONTEUDO = /<(script|style|iframe|object|embed|noscript|template|svg|math|title|head|textarea|select|option|button|form|audio|video|canvas|applet|frameset|frame|noembed|xmp|plaintext)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const ALINHAMENTOS = new Set(["left", "right", "center", "justify"]);
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Decodifica entidades numéricas e as poucas nomeadas usadas para esconder esquemas (&colon; &Tab; &NewLine; &amp; …). */
export function decodificarEntidades(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => seguroCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => seguroCodePoint(parseInt(d, 10)))
    .replace(/&(colon|tab|newline|lpar|rpar|sol|period|comma);?/gi, (_m, n: string) => ({ colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", period: ".", comma: "," })[n.toLowerCase()]!)
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}
function seguroCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** Controles, espaço, zero-width, separadores de linha e BOM (usados para esconder esquemas como "java\tscript:"). */
function ehInvisivelOuControle(c: number): boolean {
  return c <= 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;
}

/** URL segura para href: apenas http(s) e mailto (após remover controles/espaços que enganam o parser). */
export function hrefSeguro(valor: string): string | null {

  const v = Array.from(decodificarEntidades(valor)).filter((c) => !ehInvisivelOuControle(c.codePointAt(0)!)).join("");
  if (!v || v.length > 2000) return null;
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(v) ? decodificarEntidades(valor).trim() : null;
}

function atributos(tag: string, bruto: string): string {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const m of bruto.matchAll(ATTR_RE)) {
    const nome = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    if (vistos.has(nome)) continue;
    if ((nome === "colspan" || nome === "rowspan") && (tag === "td" || tag === "th") && /^\d{1,2}$/.test(val.trim()) && Number(val) >= 1 && Number(val) <= 50) {
      vistos.add(nome);
      out.push(`${nome}="${Number(val)}"`);
    } else if (nome === "style" && ["p", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "div", "li", "blockquote"].includes(tag)) {
      const al = /^\s*text-align\s*:\s*([a-z]+)\s*;?\s*$/i.exec(decodificarEntidades(val));
      if (al && ALINHAMENTOS.has(al[1].toLowerCase())) {
        vistos.add(nome);
        out.push(`style="text-align: ${al[1].toLowerCase()}"`);
      }
    } else if (nome === "align" && ["p", "div", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag) && ALINHAMENTOS.has(val.trim().toLowerCase())) {
      vistos.add(nome);
      out.push(`style="text-align: ${val.trim().toLowerCase()}"`);
    } else if (nome === "href" && tag === "a") {
      const h = hrefSeguro(val);
      if (h) {
        vistos.add(nome);
        out.push(`href="${esc(h)}"`);
      }
    } else if (nome === "start" && tag === "ol" && /^\d{1,4}$/.test(val.trim())) {
      vistos.add(nome);
      out.push(`start="${Number(val)}"`);
    }
  }
  if (tag === "a") out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
  return out.length ? " " + out.join(" ") : "";
}

/** Escapa um trecho de TEXTO preservando entidades já válidas (`&amp;` não vira `&amp;amp;`). */
function textoSeguro(t: string): string {
  return t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizarHtmlEditor(html: unknown): string {
  const origem = String(html ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, "")
    .replace(/<[?!][^>]*>?/g, "")
    .replace(DESCARTA_COM_CONTEUDO, "");
  let saida = "";
  let ultimo = 0;
  for (const m of origem.matchAll(TAG_RE)) {
    saida += textoSeguro(origem.slice(ultimo, m.index));
    ultimo = m.index! + m[0].length;
    const fecha = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!TAGS.has(tag)) continue;
    if (fecha) {
      if (!VAZIAS.has(tag)) saida += `</${tag}>`;
    } else {
      saida += `<${tag}${atributos(tag, m[3])}>`;
    }
  }
  saida += textoSeguro(origem.slice(ultimo));
  return saida;
}

/** Tamanho máximo aceito do HTML do editor (bytes de texto), conferido no servidor. */
export const MAX_HTML_EDITOR = 1_500_000;
