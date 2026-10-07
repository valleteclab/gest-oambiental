import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { listarExportacoes, solicitarExportacaoGed } from "@/lib/ged/admin/exportacao";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";

// GET → exportações da PRÓPRIA organização (GED_ADMIN)
export const GET = rota(async () => NextResponse.json({ itens: await listarExportacoes(await ctxGedApi()) }, { headers: { "Cache-Control": "private, no-store" } }));

// POST → solicita a exportação completa da própria organização (409 lógico: uma por vez)
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const r = await solicitarExportacaoGed(ctx, { ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, user_agent: req.headers.get("user-agent") });
  return NextResponse.json(r, { status: 202 });
});
