// Utilitários de PDF para o GED: contagem de páginas (pdfinfo) e texto (pdftotext) via execFile (poppler-utils).
// Sem poppler instalado, as funções devolvem null (a contagem é opcional; a extração marca ERRO e tenta de novo depois).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function executar(cmd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Executa `fn` com o PDF gravado em arquivo temporário (poppler não lê de stdin) e apaga ao final. */
export async function comPdfTemporario<T>(dados: Buffer, fn: (arquivo: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "ged-pdf-"));
  const arquivo = path.join(dir, `${randomUUID()}.pdf`);
  try {
    await writeFile(arquivo, dados);
    return await fn(arquivo);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Interpreta a saída do `pdfinfo` ("Pages:  12"). */
export function paginasDeSaidaPdfinfo(saida: string): number | null {
  const m = /^Pages:\s+(\d+)/m.exec(saida);
  return m ? Number(m[1]) : null;
}

/** Número de páginas do PDF (null se o poppler não está disponível ou o PDF é ilegível). */
export async function contarPaginasPdf(dados: Buffer): Promise<number | null> {
  try {
    return await comPdfTemporario(dados, async (f) => paginasDeSaidaPdfinfo(await executar("pdfinfo", [f], 30_000)));
  } catch {
    return null;
  }
}

/** Texto do PDF (`pdftotext -layout -enc UTF-8`). Lança se o poppler falhar. */
export async function textoDoPdf(dados: Buffer): Promise<string> {
  return comPdfTemporario(dados, (f) => executar("pdftotext", ["-layout", "-enc", "UTF-8", f, "-"], 120_000));
}

/** Texto simples a partir do HTML do editor (documentos criados no editor são indexados direto, sem pdftotext). */
export function htmlParaTexto(html: string): string {
  return limparTexto(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

/** Remove NUL (o Postgres recusa) e controles invisíveis, preservando quebras de linha e tabs. */
export function limparTexto(t: string): string {
  return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}

/** O texto extraído é "escasso" (PDF só de imagem)? Limite ~25 caracteres úteis por página. */
export function textoEscasso(texto: string, paginas: number | null): boolean {
  const uteis = texto.replace(/\s+/g, "").length;
  const pgs = Math.max(1, paginas ?? 1);
  return uteis < 25 * pgs;
}
