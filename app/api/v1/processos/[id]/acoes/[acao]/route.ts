import { NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { invalido, naoAutenticado, rota } from "@/lib/http";
import { transicionar } from "@/lib/processo/transicionar";

/** POST /api/v1/processos/{id}/acoes/{acao} – transições da máquina de estados (SPEC 6). Corpo JSON = payload da ação. */
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string; acao: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id, acao } = await params;
  let payload: unknown = {};
  const txt = await req.text();
  if (txt.trim()) {
    try {
      payload = JSON.parse(txt);
    } catch {
      throw invalido("Corpo JSON inválido.");
    }
  }
  const r = await transicionar(id, acao, payload, u);
  return NextResponse.json(r);
});
