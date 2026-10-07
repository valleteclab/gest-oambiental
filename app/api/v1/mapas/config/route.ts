import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { getUsuario } from "@/lib/auth";
import { configMapas } from "@/lib/geo/config";

export const dynamic = "force-dynamic";

// GET /api/v1/mapas/config – chave do Google Maps (lida em tempo de execução), órgão ativo (centro) e UF das camadas.
// Sem sessão: sem chave e sem órgão (os mapas públicos usam só Esri/OSM).
export const GET = rota(async () => {
  const u = await getUsuario();
  return NextResponse.json(await configMapas(u), { headers: { "Cache-Control": "private, no-store" } });
});
