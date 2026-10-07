import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { listarRecebidos } from "@/lib/ged/importacao/envio";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/importacoes/{id}/recebidos?depois={ordem}  → o que o servidor já tem do lote (retomada do envio):
// pasta: itens {ordem, caminho, tamanho, sha256, status} (páginas de 5000, `proximo` = cursor); ZIP em partes: `partes` já recebidas.
export const GET = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const depois = Number(new URL(req.url).searchParams.get("depois") ?? -1);
  return NextResponse.json(await listarRecebidos(ctx, id, { depois: Number.isFinite(depois) ? depois : -1 }));
});
