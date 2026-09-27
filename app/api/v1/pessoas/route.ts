import { NextResponse } from "next/server";
import { paginacao, proibido, rota } from "@/lib/http";
import { can } from "@/lib/rbac";
import { corpoJson, usuarioApi } from "@/lib/cadastros/api";
import { criarPessoa, listarPessoas, mascararPessoa } from "@/lib/cadastros/pessoas";

// GET /api/v1/pessoas?q=&tipo=&page=&size=  ·  POST /api/v1/pessoas
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi();
  const url = new URL(req.url);
  const pg = paginacao(url);
  const tipo = url.searchParams.get("tipo");
  const r = await listarPessoas(u, { q: url.searchParams.get("q"), tipo: tipo === "PF" || tipo === "PJ" ? tipo : null, skip: pg.skip, take: pg.take });
  return NextResponse.json({ page: pg.page, size: pg.size, total: r.total, itens: r.itens });
});

export const POST = rota(async (req: Request) => {
  const u = await usuarioApi();
  if (!can(u, "criar", "pessoa")) throw proibido();
  const p = await criarPessoa(u, await corpoJson(req));
  return NextResponse.json(mascararPessoa(p), { status: 201 });
});
