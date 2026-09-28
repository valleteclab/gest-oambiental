import { NextResponse } from "next/server";
import { ErroApi, naoEncontrado, rota } from "@/lib/http";
import { usuarioApi } from "@/lib/cadastros/api";
import { limiteMunicipio } from "@/lib/geo/ibge";
import { codigoIbgeReal } from "@/lib/geo/uf";

export const dynamic = "force-dynamic";

// GET /api/v1/mapas/limite/{codigo_ibge} – limite do município (GeoJSON) da API de malhas do IBGE, com cache em memória.
export const GET = rota(async (_req: Request, ctx: { params: Promise<{ codigo: string }> }) => {
  await usuarioApi();
  const { codigo } = await ctx.params;
  if (!codigoIbgeReal(codigo)) throw naoEncontrado("Código IBGE inválido ou fictício.");
  let fc: GeoJSON.FeatureCollection | null;
  try {
    fc = await limiteMunicipio(codigo);
  } catch (e) {
    console.warn("[mapas/limite] IBGE indisponível:", e instanceof Error ? e.message : e);
    throw new ErroApi(502, "SERVICO_EXTERNO", "A API de malhas do IBGE não respondeu.");
  }
  if (!fc) throw naoEncontrado("Malha do município não encontrada no IBGE.");
  return NextResponse.json(fc, { headers: { "Content-Type": "application/geo+json", "Cache-Control": "private, max-age=86400" } });
});
