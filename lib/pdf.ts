import "server-only";
import puppeteer, { type Browser } from "puppeteer-core";

// HTML → PDF com Chromium headless (SPEC 3 / 7). CHROMIUM_PATH aponta para o binário do Chromium.
let navegador: Promise<Browser> | null = null;

function obterNavegador() {
  navegador ??= puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    headless: true,
  });
  navegador.catch(() => (navegador = null));
  return navegador;
}

export type OpcoesPdf = { paisagem?: boolean; rodapeHtml?: string; cabecalhoHtml?: string; margem?: string };

export async function htmlParaPdf(html: string, opts: OpcoesPdf = {}): Promise<Buffer> {
  const b = await obterNavegador();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    const margem = opts.margem ?? "18mm";
    const pdf = await page.pdf({
      format: "A4",
      landscape: !!opts.paisagem,
      printBackground: true,
      displayHeaderFooter: !!(opts.rodapeHtml || opts.cabecalhoHtml),
      headerTemplate: opts.cabecalhoHtml ?? "<span></span>",
      footerTemplate: opts.rodapeHtml ?? "<span></span>",
      margin: { top: margem, bottom: opts.rodapeHtml ? "32mm" : margem, left: "15mm", right: "15mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Escapa texto para interpolação segura em modelos HTML. */
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
