// HTML do editor → PDF A4 com papel timbrado do cliente (nome + logo), número, título, data e paginação.
// Usa htmlParaPdf (Chromium). O HTML do corpo é SEMPRE sanitizado aqui (defesa em profundidade).
import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fmtData, fmtDataCivil } from "@/lib/format";
import { logoProprio, imagemDataUri } from "@/lib/imagem";
import { esc, htmlParaPdf } from "@/lib/pdf";
import { sanitizarHtmlEditor } from "./sanitizar";

export type DadosPdfEditor = {
  organizacao: { nome: string; logo_url: string | null };
  numero: string;
  titulo: string;
  tipo?: string | null;
  remetente?: string | null;
  /** @db.Date (data civil) – se ausente usa a data de emissão. */
  data_documento?: Date | null;
  html: string;
};

const CSS = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { font-family: "Liberation Serif", "Times New Roman", Georgia, serif; font-size: 12pt; line-height: 1.5; color: #111; margin: 0; }
  header.timbre { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #064e3b; padding-bottom: 10px; margin-bottom: 14px; }
  header.timbre img { max-height: 64px; max-width: 220px; object-fit: contain; }
  header.timbre .org { font-family: Arial, Helvetica, sans-serif; font-size: 14pt; font-weight: 700; color: #064e3b; }
  .meta { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #333; margin-bottom: 16px; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  .meta dt { font-weight: 700; } .meta dd { margin: 0; }
  h1.titulo { font-family: Arial, Helvetica, sans-serif; font-size: 16pt; margin: 0 0 12px; text-align: center; }
  .corpo h1 { font-size: 16pt; } .corpo h2 { font-size: 14pt; } .corpo h3 { font-size: 12.5pt; }
  .corpo h1, .corpo h2, .corpo h3, .corpo h4 { font-family: Arial, Helvetica, sans-serif; line-height: 1.25; margin: 14px 0 6px; break-after: avoid; }
  .corpo p { margin: 0 0 8px; } .corpo ul, .corpo ol { margin: 0 0 8px; padding-left: 26px; }
  .corpo blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #94a3b8; color: #334155; }
  .corpo table { border-collapse: collapse; width: 100%; margin: 8px 0; table-layout: auto; }
  .corpo th, .corpo td { border: 1px solid #475569; padding: 4px 6px; vertical-align: top; }
  .corpo th { background: #e2e8f0; font-weight: 700; }
  .corpo tr { break-inside: avoid; }
  .corpo pre { background: #f1f5f9; padding: 8px; white-space: pre-wrap; font-size: 10pt; } .corpo code { font-family: "Liberation Mono", monospace; font-size: 10pt; }
  .corpo a { color: #0f4c81; text-decoration: underline; }
`;

export async function montarHtmlDocumento(d: DadosPdfEditor): Promise<string> {
  const logo = logoProprio(d.organizacao.logo_url);
  const dataUri = logo ? await imagemDataUri(logo) : null;
  const data = d.data_documento ? fmtDataCivil(d.data_documento) : fmtData(new Date());
  const meta = [
    ["Número", d.numero],
    ["Data", data],
    ...(d.tipo ? [["Tipo", d.tipo]] : []),
    ...(d.remetente ? [["Remetente", d.remetente]] : []),
  ];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(d.titulo)}</title><style>${CSS}</style></head><body>
<header class="timbre">${dataUri ? `<img src="${dataUri}" alt="">` : ""}<div class="org">${esc(d.organizacao.nome)}</div></header>
<dl class="meta">${meta.map(([k, v]) => `<dt>${esc(k)}:</dt><dd>${esc(v)}</dd>`).join("")}</dl>
<h1 class="titulo">${esc(d.titulo)}</h1>
<main class="corpo">${sanitizarHtmlEditor(d.html)}</main>
</body></html>`;
}

/** Rodapé do Chromium (numeração "Página X de Y"). */
export const rodapePaginacao = (numero: string, org: string) =>
  `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#475569;padding:0 15mm;display:flex;justify-content:space-between"><span>${esc(org)} · ${esc(numero)}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;

export async function gerarPdfDocumento(d: DadosPdfEditor): Promise<Buffer> {
  const html = await montarHtmlDocumento(d);
  return htmlParaPdf(html, { rodapeHtml: rodapePaginacao(d.numero, d.organizacao.nome), margem: "16mm" });
}

/** PDF de uma página para a versão-rascunho (não usa Chromium; criado junto com o documento). */
export async function pdfRascunhoVazio(titulo: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Documento em edicao (rascunho)", { x: 56, y: 760, size: 16, font: fonte, color: rgb(0.02, 0.3, 0.23) });
  const t = titulo.normalize("NFD").replace(/[^\x20-\x7e]/g, "").slice(0, 90);
  page.drawText(t, { x: 56, y: 735, size: 11, font: fonte, color: rgb(0.2, 0.2, 0.2) });
  page.drawText("O PDF definitivo sera gerado ao finalizar no editor.", { x: 56, y: 715, size: 10, font: fonte, color: rgb(0.4, 0.4, 0.4) });
  return Buffer.from(await pdf.save());
}
