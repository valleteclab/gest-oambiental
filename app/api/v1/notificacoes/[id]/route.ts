import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";
import { obterNotificacao } from "@/lib/fiscalizacao/servico";

export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await usuarioApi();
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  return NextResponse.json(await obterNotificacao(u, id));
});
