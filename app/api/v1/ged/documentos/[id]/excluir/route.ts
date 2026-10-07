import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerEntradaExclusao, respostaInicio } from "@/lib/ged/exclusao/http";
import { iniciarExclusao, previaExclusao } from "@/lib/ged/exclusao/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/documentos/:id/excluir – pré-visualização (o que seria excluído e o que impede). Admin/Gestor; Administrar + Ver no documento.
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return NextResponse.json(await previaExclusao(ctx, { tipo: "DOCUMENTO", id }));
});

// POST /api/v1/ged/documentos/:id/excluir  { confirmacao: "EXCLUIR" } – exclui definitivamente (documento com valor jurídico → 409).
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return respostaInicio(await iniciarExclusao(ctx, { tipo: "DOCUMENTO", id }, await lerEntradaExclusao(req)));
});
