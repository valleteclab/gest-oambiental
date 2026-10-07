import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { finalizarDocumento } from "@/lib/ged/editor/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const uuid = (id: string) => { if (!z.string().uuid().safeParse(id).success) throw invalido("Identificador inválido."); return id; };

// POST /api/v1/ged/editor/{id}/finalizar  { html } → { versao_id, n, sha256 }  (gera o PDF; exige EDITAR)
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const corpo = z.object({ html: z.string() }).parse(await req.json().catch(() => { throw invalido("Corpo JSON inválido."); }));
  return NextResponse.json(await finalizarDocumento(ctx, { documento_id: uuid((await params).id), html: corpo.html }), { status: 201 });
});

