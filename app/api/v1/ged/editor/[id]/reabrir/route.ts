import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { reabrirParaEdicao } from "@/lib/ged/editor/servico";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/editor/{id}/reabrir → reabre o documento finalizado para edição (nova versão-rascunho; exige EDITAR)
export const POST = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw invalido("Identificador inválido.");
  await reabrirParaEdicao(ctx, id);
  return NextResponse.json({ ok: true });
});
