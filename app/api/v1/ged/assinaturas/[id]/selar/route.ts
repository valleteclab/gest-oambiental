import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";

import { tentarSelar } from "@/lib/ged/assinaturas/servico";
import { ctxGedApi } from "@/lib/ged/escopo";
import { zUuid } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/assinaturas/:id/selar  (sem corpo)  refaz o selo de uma solicitação com todas as assinaturas
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const id = zUuid.safeParse((await params).id);
  if (!id.success) throw naoEncontrado("Solicitação não encontrada.");
  const r = await tentarSelar(ctx, id.data);
  return NextResponse.json(r);
});
