import { NextResponse } from "next/server";
import { paginacao, proibido, rota } from "@/lib/http";
import { can } from "@/lib/rbac";
import { corpoJson, usuarioApi } from "@/lib/cadastros/api";
import { criarEmpreendimento, listarEmpreendimentos } from "@/lib/cadastros/empreendimentos";

// GET /api/v1/empreendimentos?q=&municipio=&tipologia=&status=&page=&size=  ·  POST
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi();
  if (!can(u, "ver", "empreendimento")) throw proibido();
  const url = new URL(req.url);
  const pg = paginacao(url);
  const s = url.searchParams;
  const status = s.get("status");
  const r = await listarEmpreendimentos(u, {
    q: s.get("q"), municipio_id: s.get("municipio"), tipologia_id: s.get("tipologia"), requerente_id: s.get("requerente"),
    status: status === "ATIVO" || status === "INATIVO" ? status : null, skip: pg.skip, take: pg.take,
  });
  return NextResponse.json({ page: pg.page, size: pg.size, total: r.total, itens: r.itens });
});

export const POST = rota(async (req: Request) => {
  const u = await usuarioApi();
  const e = await criarEmpreendimento(u, await corpoJson(req));
  return NextResponse.json(e, { status: 201 });
});
