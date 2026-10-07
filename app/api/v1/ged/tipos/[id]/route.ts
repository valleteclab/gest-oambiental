import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { atualizarTipoDocumento, excluirTipoDocumento } from "@/lib/ged/tipos-documento";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  await atualizarTipoDocumento(ctx, id, await req.json().catch(() => ({})));
  return NextResponse.json({ ok: true });
});

export const DELETE = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  await excluirTipoDocumento(ctx, id);
  return NextResponse.json({ ok: true });
});
