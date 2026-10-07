import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarMarcador, listarMarcadores } from "@/lib/ged/marcadores";

export const dynamic = "force-dynamic";

export const GET = rota(async () => {
  const ctx = await ctxGedApi();
  return NextResponse.json({ data: await listarMarcadores(ctx) });
});

// POST – exige papel Administrador/Gestor
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json().catch(() => ({}));
  return NextResponse.json(await criarMarcador(ctx, corpo), { status: 201 });
});
