import { NextResponse } from "next/server";
import { naoEncontrado, proibido, rota } from "@/lib/http";
import { corpoJson, usuarioApi } from "@/lib/cadastros/api";
import { atualizarResponsavel, obterResponsavel } from "@/lib/cadastros/responsaveis";

type Ctx = { params: Promise<{ id: string }> };

export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const u = await usuarioApi();
  const r = await obterResponsavel(u, (await params).id);
  if (r === null) throw naoEncontrado();
  if (r === "PROIBIDO") throw proibido();
  return NextResponse.json(r);
});

export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const u = await usuarioApi();
  const r = await atualizarResponsavel(u, (await params).id, await corpoJson(req));
  return NextResponse.json(r);
});
