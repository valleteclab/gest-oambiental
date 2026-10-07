import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerEntradaExclusao, respostaInicio } from "@/lib/ged/exclusao/http";
import { iniciarExclusao, previaExclusao } from "@/lib/ged/exclusao/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/pastas/:id/excluir– pré-visualização da exclusão da pasta com toda a subárvore.
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return NextResponse.json(await previaExclusao(ctx, { tipo: "PASTA", id }));
});

// POST /api/v1/ged/pastas/:id/excluir  { confirmacao: "<nome da pasta>", apenas_possiveis?: boolean }
// Tudo-ou-nada por padrão: se algum documento tiver valor jurídico/registro imutável, nada é excluído (409 com a lista).
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return respostaInicio(await iniciarExclusao(ctx, { tipo: "PASTA", id }, await lerEntradaExclusao(req)));
});
