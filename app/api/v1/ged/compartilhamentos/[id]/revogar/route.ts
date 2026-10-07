import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { revogarCompartilhamento } from "@/lib/ged/compartilhamento/servico";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/compartilhamentos/:id/revogar  { motivo? } – o mesmo que DELETE /compartilhamentos/:id
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const c = (await req.json().catch(() => ({}))) as { motivo?: string };
  return NextResponse.json(await revogarCompartilhamento(ctx, (await params).id, c.motivo));
});
