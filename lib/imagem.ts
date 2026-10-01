import { readFile } from "node:fs/promises";
import path from "node:path";

// Imagens institucionais (brasão do município, logo da organização) para PDFs/planilhas: o Chromium do PDF
// não acessa URLs relativas do app, então a imagem é lida do disco (public/) ou baixada (http[s]) e embutida
// como data URI. Funciona igual em produção (standalone: public/ é copiado para a imagem Docker).

const MIME: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const LIMITE = 2 * 1024 * 1024;

/** O logo da organização é um logo "horizontal" próprio? (o brasão genérico da plataforma não conta) */
export function logoProprio(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  if (!u || /brasao-generico\.svg$/i.test(u)) return null;
  return u;
}

/** Lê uma imagem pública (caminho "/…" em public/, data URI ou URL http[s]). null se indisponível/inválida. */
export async function lerImagem(url: string | null | undefined): Promise<{ buf: Buffer; mime: string } | null> {
  const u = (url ?? "").trim();
  if (!u) return null;
  try {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(u);
    if (m) return { mime: m[1], buf: Buffer.from(m[2], "base64") };
    if (/^https?:\/\//i.test(u)) {
      const r = await fetch(u, { signal: AbortSignal.timeout(4000) });
      const tipo = (r.headers.get("content-type") ?? "").split(";")[0];
      if (!r.ok || !tipo.startsWith("image/")) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.length > LIMITE ? null : { buf, mime: tipo };
    }
    if (u.startsWith("/")) {
      const publico = path.resolve(process.cwd(), "public");
      const arq = path.resolve(publico, "." + u.split("?")[0]);
      if (!arq.startsWith(publico + path.sep)) return null;
      const mime = MIME[path.extname(arq).toLowerCase()];
      if (!mime) return null;
      const buf = await readFile(arq);
      return buf.length > LIMITE ? null : { buf, mime };
    }
  } catch {
    /* indisponível */
  }
  return null;
}

export async function imagemDataUri(url: string | null | undefined): Promise<string | null> {
  const img = await lerImagem(url);
  return img ? `data:${img.mime};base64,${img.buf.toString("base64")}` : null;
}
