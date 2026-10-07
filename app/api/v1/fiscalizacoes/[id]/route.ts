import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";
import { obterFiscalizacao } from "@/lib/fiscalizacao/servico";

export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await usuarioApi();
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const f = await obterFiscalizacao(u, id);
  return NextResponse.json({ ...f, anexos: f.anexos.map((a) => ({ ...a, url: `/api/v1/fiscalizacoes/${id}/fotos/${a.id}` })) });
});
