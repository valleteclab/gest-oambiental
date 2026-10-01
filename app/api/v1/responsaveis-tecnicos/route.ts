import { NextResponse } from "next/server";
import { paginacao, rota } from "@/lib/http";
import { corpoJson, usuarioApi } from "@/lib/cadastros/api";
import { criarResponsavel, listarResponsaveis } from "@/lib/cadastros/responsaveis";

export const GET = rota(async (req: Request) => {
  const u = await usuarioApi();
  const url = new URL(req.url);
  const pg = paginacao(url);
  const r = await listarResponsaveis(u, { q: url.searchParams.get("q"), skip: pg.skip, take: pg.take });
  return NextResponse.json({ page: pg.page, size: pg.size, total: r.total, itens: r.itens });
});

export const POST = rota(async (req: Request) => {
  const u = await usuarioApi();
  const r = await criarResponsavel(u, await corpoJson(req));
  return NextResponse.json(r, { status: 201 });
});
