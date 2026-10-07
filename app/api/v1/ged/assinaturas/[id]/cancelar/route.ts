import { NextResponse } from "next/server";
import { invalido, naoEncontrado, rota } from "@/lib/http";

import { cancelarSolicitacao } from "@/lib/ged/assinaturas/servico";
import { ctxGedApi } from "@/lib/ged/escopo";
import { zUuid } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/assinaturas/:id/cancelar  { motivo? }  (autor da solicitação ou ADMINISTRAR no documento)
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const id = zUuid.safeParse((await params).id);
  if (!id.success) throw naoEncontrado("Solicitação não encontrada.");
  const corpo = await req.json().catch(() => { throw invalido("Corpo JSON inválido."); });
  await cancelarSolicitacao(ctx, { ...corpo, solicitacao_id: id.data });
  return NextResponse.json({ ok: true });
});
