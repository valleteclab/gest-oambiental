import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";
import { emitirPdfAuto } from "@/lib/fiscalizacao/servico";

// POST /api/v1/autos-infracao/{id}/pdf – (re)tenta emitir o PDF quando a emissão anterior falhou
export const POST = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await usuarioApi();
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const r = await emitirPdfAuto(u, id);
  return NextResponse.json(r, { status: r.documento_id ? 200 : 502 });
});
