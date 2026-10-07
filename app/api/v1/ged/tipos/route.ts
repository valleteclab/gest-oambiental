import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarTipoDocumento, listarTiposDocumento } from "@/lib/ged/tipos-documento";

export const dynamic = "force-dynamic";

export const GET = rota(async () => {
  const ctx = await ctxGedApi();
  return NextResponse.json({ data: await listarTiposDocumento(ctx) });
});

// POST – exige papel Administrador/Gestor
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json().catch(() => ({}));
  return NextResponse.json(await criarTipoDocumento(ctx, corpo), { status: 201 });
});
