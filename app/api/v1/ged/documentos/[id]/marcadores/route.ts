import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { definirMarcadoresDocumento, marcadoresDoDocumento } from "@/lib/ged/marcadores";
import { exigirDocumento } from "@/lib/ged/permissoes";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  await exigirDocumento(ctx, id, "VER");
  return NextResponse.json({ data: await marcadoresDoDocumento(ctx, id) });
});

// PUT /api/v1/ged/documentos/:id/marcadores – { marcador_ids: string[] } (substitui o conjunto; exige Editar)
export const PUT = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const corpo = (await req.json().catch(() => ({}))) as { marcador_ids?: string[] };
  return NextResponse.json(await definirMarcadoresDocumento(ctx, id, corpo.marcador_ids ?? []));
});
