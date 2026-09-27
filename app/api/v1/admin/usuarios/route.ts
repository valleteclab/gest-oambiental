import { NextResponse } from "next/server";
import { paginacao, rota } from "@/lib/http";
import { exigirAdmin } from "@/lib/admin/guard";
import { corpoJson } from "@/lib/cadastros/api";
import { criarUsuario, listarUsuarios } from "@/lib/admin/usuarios";

// GET /api/v1/admin/usuarios?q=&papel=&municipio=&ativo=  ·  POST (retorna senha_temporaria uma única vez)
export const GET = rota(async (req: Request) => {
  await exigirAdmin();
  const url = new URL(req.url);
  const pg = paginacao(url);
  const s = url.searchParams;
  const ativo = s.get("ativo");
  const r = await listarUsuarios({ q: s.get("q"), papel: s.get("papel"), municipio_id: s.get("municipio"), ativo: ativo === "true" ? true : ativo === "false" ? false : null, skip: pg.skip, take: pg.take });
  return NextResponse.json({ page: pg.page, size: pg.size, total: r.total, itens: r.itens });
});

export const POST = rota(async (req: Request) => {
  const admin = await exigirAdmin();
  const r = await criarUsuario(admin, await corpoJson(req));
  return NextResponse.json({ id: r.usuario.id, email: r.usuario.email, trocar_senha: true, senha_temporaria: r.senhaTemporaria }, { status: 201 });
});
