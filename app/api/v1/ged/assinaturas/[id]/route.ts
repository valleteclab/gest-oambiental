import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";
import { detalheSolicitacao } from "@/lib/ged/assinaturas/consultas";
import { ctxGedApi } from "@/lib/ged/escopo";
import { zUuid } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/assinaturas/:id  → { solicitacao, documento, comentarios } (404 sem VER no documento / outro cliente)
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const id = zUuid.safeParse((await params).id);
  if (!id.success) throw naoEncontrado("Solicitação não encontrada.");
  const { solicitacao, documento, comentarios } = await detalheSolicitacao(ctx, id.data);
  return NextResponse.json({ solicitacao, documento, comentarios });
});
