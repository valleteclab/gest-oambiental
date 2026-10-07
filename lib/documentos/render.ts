// Helpers PUROS de renderização de documentos oficiais (sem banco/IO) – testados em tests/unit/documentos.test.ts.
import { abreviarNome } from "../crypto";

/** Escapa texto para HTML (mesma regra de `esc` de lib/pdf.ts, sem puxar o Chromium para o bundle). */
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Valor de um caminho "a.b.c" num objeto. */
function obter(obj: Record<string, unknown>, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

/**
 * Substitui placeholders de `modelo_documento.html`:
 *  - `{{chave}}` / `{{a.b}}` → valor ESCAPADO;
 *  - `{{{chave}}}` → HTML bruto (apenas para variáveis *_html geradas pelo sistema; sempre sanitizado).
 * Placeholders desconhecidos viram string vazia.
 */
export function aplicarPlaceholders(html: string, vars: Record<string, unknown>): string {
  return html
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_m, k: string) => sanitizarHtml(String(obter(vars, k) ?? "")))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => esc(formatarValor(obter(vars, k))));
}

function formatarValor(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });
  if (Array.isArray(v)) return v.map((x) => formatarValor(x)).join("; ");
  if (typeof v === "object") return "";
  return String(v);
}

const TAGS_PERMITIDAS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "blockquote", "span", "div", "hr", "sup", "sub", "small", "caption", "colgroup", "col", "pre", "code",
]);
const ATRIBUTOS_PERMITIDOS = new Set(["colspan", "rowspan", "align", "class"]);

/**
 * Sanitizador conservador por whitelist para HTML vindo de usuários (ex.: texto do parecer) antes de ir ao Chromium.
 * Remove scripts/estilos/iframes/imagens externas, atributos de evento e qualquer URL.
 */
export function sanitizarHtml(html: string): string {
  return String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math|title|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (tag, nome: string, attrs: string) => {
      const n = nome.toLowerCase();
      if (!TAGS_PERMITIDAS.has(n)) return "";
      if (tag.startsWith("</")) return `</${n}>`;
      const seguros: string[] = [];
      for (const m of attrs.matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        const a = m[1].toLowerCase();
        const val = m[3] ?? m[4] ?? m[5] ?? "";
        if (ATRIBUTOS_PERMITIDOS.has(a) && /^[\w\s-]*$/.test(val)) seguros.push(`${a}="${esc(val)}"`);
      }
      const autoFecha = /\/\s*$/.test(attrs) || n === "br" || n === "hr" || n === "col";
      return `<${n}${seguros.length ? " " + seguros.join(" ") : ""}${autoFecha && n !== "br" && n !== "hr" && n !== "col" ? " /" : ""}>`;
    })
    // qualquer "<" solto que sobrou (ex.: "<script" sem fechamento) é neutralizado
    .replace(new RegExp(`<(?!/?(?:${[...TAGS_PERMITIDAS].join("|")})(?:\\s[^<>]*)?>)`, "g"), "&lt;");
}

/** Converte texto simples em parágrafos HTML escapados (quebra de linha dupla = novo parágrafo). */
export function textoParaHtml(texto: unknown): string {
  const t = String(texto ?? "").trim();
  if (!t) return "";
  return t
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Endereço (jsonb) → linha única. Aceita string ou objeto {logradouro, numero, complemento, bairro, cidade, uf, cep}. */
export function formatarEndereco(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (typeof e !== "object") return "";
  const x = e as Record<string, unknown>;
  const s = (k: string) => (x[k] ? String(x[k]) : "");
  const l1 = [s("logradouro"), s("numero")].filter(Boolean).join(", ");
  const partes = [l1, s("complemento"), s("bairro"), [s("cidade"), s("uf")].filter(Boolean).join("/"), s("cep") ? `CEP ${s("cep")}` : ""].filter(Boolean);
  return partes.join(" – ");
}

/** Normaliza código verificador digitado ("7kq2m9xad3pl", "7KQ2 M9XA D3PL") → "7KQ2-M9XA-D3PL". Retorna null se inválido. */
export function normalizarCodigo(v: string | null | undefined): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0");
  if (s.length !== 12) return null;
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export type StatusPublico = "VALIDO" | "CANCELADO" | "SUBSTITUIDO" | "VENCIDO";

/** Status exibido na validação pública: VÁLIDO vira VENCIDO quando a validade passou. */
export function statusPublico(d: { status: "VALIDO" | "CANCELADO" | "SUBSTITUIDO"; validade_ate: Date | string | null }, agora = new Date()): StatusPublico {
  if (d.status !== "VALIDO") return d.status;
  if (d.validade_ate) {
    const v = new Date(d.validade_ate);
    // válido até o fim do dia da validade
    const fim = new Date(v);
    fim.setUTCHours(23, 59, 59, 999);
    if (fim.getTime() < agora.getTime()) return "VENCIDO";
  }
  return "VALIDO";
}

export const ROTULO_STATUS_PUBLICO: Record<StatusPublico, string> = {
  VALIDO: "VÁLIDO",
  CANCELADO: "CANCELADO",
  SUBSTITUIDO: "SUBSTITUÍDO",
  VENCIDO: "VENCIDO",
};

export const ROTULO_TIPO_DOCUMENTO: Record<string, string> = {
  LICENCA: "Licença ambiental",
  AUTORIZACAO: "Autorização ambiental",
  CERTIDAO: "Certidão",
  AUTO_INFRACAO: "Auto de infração",
  NOTIFICACAO: "Notificação",
  PARECER: "Parecer técnico",
  OFICIO: "Ofício",
  RECIBO: "Recibo de protocolo",
};

/** Tipos de documento de interesse público (transparência / download anônimo quando VÁLIDOS). */
export const TIPOS_PUBLICOS = ["LICENCA", "AUTORIZACAO", "CERTIDAO"] as const;

/** Titular como exibido publicamente: PF → nome abreviado; PJ → razão social. Documento sempre mascarado. */
export function titularPublico(p: { tipo: "PF" | "PJ"; nome: string; cpf_cnpj_mascara?: string | null } | null | undefined): { nome: string; documento: string } | null {
  if (!p) return null;
  return { nome: p.tipo === "PF" ? abreviarNome(p.nome) : p.nome, documento: p.cpf_cnpj_mascara || "***" };
}

/** Host exibido no rodapé ("Verifique a autenticidade em {dominio}/validar"). */
export function dominioDe(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}
