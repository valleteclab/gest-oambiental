import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { definirDadosPessoais } from "@/lib/ged/documentos/servico";

export const dynamic = "force-dynamic";

// PUT /api/v1/ged/documentos/:id/dados-pessoais – { contem: boolean } (exige Anonimizar ou Editar)
export const PUT = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const corpo = (await req.json().catch(() => ({}))) as { contem?: unknown };
  return NextResponse.json(await definirDadosPessoais(ctx, id, corpo.contem === true));
});
