import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { revogarAcl } from "@/lib/ged/acl";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";

// DELETE /api/v1/ged/acl/:id  → revoga a permissão (exige ADMINISTRAR no recurso; outro cliente/inexistente → 404)
export const DELETE = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  await revogarAcl(ctx, id);
  return NextResponse.json({ ok: true });
});
