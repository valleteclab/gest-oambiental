import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { abrirEditor, salvarRascunho } from "@/lib/ged/editor/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const uuid = (id: string) => { if (!z.string().uuid().safeParse(id).success) throw invalido("Identificador inválido."); return id; };

// GET /api/v1/ged/editor/{id}/rascunho → { documento, estado, html, atualizado_em } (exige EDITAR)
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  return NextResponse.json(await abrirEditor(ctx, uuid((await params).id)));
});

// PUT /api/v1/ged/editor/{id}/rascunho  { html, base_em?, forcar? } → { ok, atualizado_em } | 409 { ok:false, conflito:true }
export const PUT = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const corpo = z.object({ html: z.string(), base_em: z.string().nullable().optional(), forcar: z.boolean().optional() }).parse(await req.json().catch(() => { throw invalido("Corpo JSON inválido."); }));
  const r = await salvarRascunho(ctx, { documento_id: uuid((await params).id), ...corpo });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
});
