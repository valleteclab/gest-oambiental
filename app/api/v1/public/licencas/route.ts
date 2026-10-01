import { NextResponse } from "next/server";
import { listarLicencasPublicas } from "@/lib/documentos/publico";
import { paginacao, rota } from "@/lib/http";

/** GET /api/v1/public/licencas?municipio=ITB&tipo=LICENCA&sigla=LO&de=aaaa-mm-dd&ate=aaaa-mm-dd&page=&size= */
export const GET = rota(async (req: Request) => {
  const url = new URL(req.url);
  const { page, size } = paginacao(url);
  const take = Math.min(size, 100);
  const skip = (page - 1) * take;
  const q = url.searchParams;
  const r = await listarLicencasPublicas({ municipio: q.get("municipio"), tipo: q.get("tipo"), sigla: q.get("sigla"), de: q.get("de"), ate: q.get("ate"), skip, take });
  return NextResponse.json({ page, size: take, total: r.total, itens: r.itens.map(({ codigo_verificador, ...x }) => ({ ...x, codigo_verificador, url_validacao: `/validar/${codigo_verificador}` })) });
});
