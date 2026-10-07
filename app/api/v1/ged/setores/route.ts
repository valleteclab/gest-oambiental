import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarSetor, listarSetores } from "@/lib/ged/setores";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/setores?inativos=1  → { itens } (qualquer membro do GED lê)
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const inativos = new URL(req.url).searchParams.get("inativos") === "1";
  return NextResponse.json({ itens: await listarSetores(ctx, { incluirInativos: inativos }) });
});

// POST /api/v1/ged/setores  { nome, sigla }  (somente GED_ADMIN/GED_GESTOR)
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json().catch(() => { throw invalido("Corpo JSON inválido."); });
  return NextResponse.json(await criarSetor(ctx, corpo), { status: 201 });
});
