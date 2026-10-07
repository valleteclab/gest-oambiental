import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";
import { ehUuid, lerCorpoComFotos, usuarioApi } from "@/lib/fiscalizacao/api";
import { adicionarFotos } from "@/lib/fiscalizacao/servico";

// POST /api/v1/fiscalizacoes/{id}/fotos – multipart (fotos, fotos_meta)
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await usuarioApi();
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const { fotos } = await lerCorpoComFotos(req);
  return NextResponse.json({ fotos: await adicionarFotos(u, id, fotos) }, { status: 201 });
});
