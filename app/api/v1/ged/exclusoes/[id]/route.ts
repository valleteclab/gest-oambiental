import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { obterExclusao } from "@/lib/ged/exclusao/servico";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/exclusoes/:id – progresso (status, documentos/pastas/versões/MB excluídos, percentual). Outro cliente → 404.
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return NextResponse.json(await obterExclusao(ctx, id));
});
