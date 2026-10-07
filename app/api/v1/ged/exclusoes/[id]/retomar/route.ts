import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { retomarExclusao } from "@/lib/ged/exclusao/servico";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/exclusoes/:id/retomar – retoma uma exclusão que falhou (o que já foi excluído não é refeito).
export const POST = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return NextResponse.json(await retomarExclusao(ctx, id), { status: 202 });
});
