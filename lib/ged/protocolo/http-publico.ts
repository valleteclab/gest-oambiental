// Utilitários HTTP das rotas PÚBLICAS do protocolo (sem sessão): cabeçalhos sem cache/indexação e leitura do corpo com limite.
import { NextResponse } from "next/server";
import { ErroApi, invalido } from "@/lib/http";
import type { AnexoEntrada } from "./servico";

export const CABECALHOS_PUBLICOS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

export const jsonPublico = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: CABECALHOS_PUBLICOS });

/** Recusa cedo (413) corpo maior que o permitido pelo portal (arquivos + folga para os campos). */
export function exigirTamanhoCorpo(req: Request, maxBytes: number) {
  const n = Number(req.headers.get("content-length"));
  if (Number.isFinite(n) && n > maxBytes) throw new ErroApi(413, "ARQUIVO_GRANDE", "O envio é maior do que o permitido.");
}

export type CamposPortal = Record<string, string>;
/** Campos de texto + arquivos ("arquivos", repetido) do formulário multipart do portal. */
export async function lerFormularioPortal(req: Request): Promise<{ campos: CamposPortal; arquivos: AnexoEntrada[] }> {
  const form = await req.formData().catch(() => null);
  if (!form) throw invalido("Não foi possível ler o formulário enviado.");
  const campos: CamposPortal = {};
  const arquivos: AnexoEntrada[] = [];
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") campos[k] = v.slice(0, 6000);
    else if (k === "arquivos" && v.size > 0) arquivos.push({ arquivo: Buffer.from(await v.arrayBuffer()), nome_arquivo: v.name, mime: v.type });
  }
  return { campos, arquivos };
}
