import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { restaurarDocumento } from "@/lib/ged/documentos/servico";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/documentos/:id/restaurar – exige a permissão Administrar no documento
export const POST = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  await restaurarDocumento(ctx, id);
  return NextResponse.json({ ok: true });
});
