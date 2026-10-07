import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerEntradaExclusao, respostaInicio } from "@/lib/ged/exclusao/http";
import { iniciarExclusao, previaExclusao } from "@/lib/ged/exclusao/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/importacoes/:id/excluir– pré-visualização: documentos importados pelo lote e pastas que ele criou.
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return NextResponse.json(await previaExclusao(ctx, { tipo: "IMPORTACAO", id }));
});

// POST /api/v1/ged/importacoes/:id/excluir  { confirmacao: "EXCLUIR", apenas_possiveis?: boolean } – "importei errado, quero refazer".
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return respostaInicio(await iniciarExclusao(ctx, { tipo: "IMPORTACAO", id }, await lerEntradaExclusao(req)));
});
