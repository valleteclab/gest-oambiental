import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { detalharCompartilhamento, revogarCompartilhamento } from "@/lib/ged/compartilhamento/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/compartilhamentos/:id – detalhe com os últimos eventos (acessos). Só quem criou (ou o Administrador); outros = 404.
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  return NextResponse.json(await detalharCompartilhamento(ctx, (await params).id));
});

// DELETE /api/v1/ged/compartilhamentos/:id – revoga (efeito imediato, inclusive sessões abertas). Idempotente.
export const DELETE = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const c = (await req.json().catch(() => ({}))) as { motivo?: string };
  return NextResponse.json(await revogarCompartilhamento(ctx, (await params).id, c.motivo));
});
