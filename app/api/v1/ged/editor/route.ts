import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarDocumentoEditor } from "@/lib/ged/editor/servico";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/editor  { titulo, tipo_id?, remetente?, data_documento?, sensibilidade?, pasta_id? } → { id, numero }
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json().catch(() => { throw invalido("Corpo JSON inválido."); });
  return NextResponse.json(await criarDocumentoEditor(ctx, corpo), { status: 201 });
});
