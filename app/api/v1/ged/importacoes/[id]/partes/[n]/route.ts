import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerCorpoLimitado } from "@/lib/ged/importacao/corpo";
import { receberParteZip } from "@/lib/ged/importacao/envio";
import { MAX_PARTE_ZIP } from "@/lib/ged/importacao/limites";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// PUT /api/v1/ged/importacoes/{id}/partes/{n} – parte n (1-based) do ZIP em partes. Corpo = bytes da parte (8 MB, a última com o resto).
// Idempotente: reenviar a mesma parte substitui. Cabeçalho opcional X-Sha256 confere a integridade.
async function tratar(req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const ctx = await ctxGedApi();
  const { id, n } = await params;
  const num = Number(n);
  if (!Number.isInteger(num)) throw invalido("Número da parte inválido.");
  const dados = await lerCorpoLimitado(req, MAX_PARTE_ZIP);
  const esperado = req.headers.get("x-sha256");
  if (esperado) {
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(dados).digest("hex") !== esperado.toLowerCase()) throw invalido("A parte chegou corrompida (sha256 diferente). Tente enviar de novo.");
  }
  return NextResponse.json(await receberParteZip(ctx, id, num, dados));
}
export const PUT = rota(tratar);
export const POST = rota(tratar);
