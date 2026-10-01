import { NextResponse } from "next/server";
import { paginacao, rota } from "@/lib/http";
import { parametro, usuarioApi } from "@/lib/fiscalizacao/api";
import { AutoInfracaoSchema } from "@/lib/fiscalizacao/schemas";
import { criarAutoInfracao, listarAutos } from "@/lib/fiscalizacao/servico";

// GET /api/v1/autos-infracao?municipio=&status=&penalidade=&page=&size=
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi();
  const url = new URL(req.url);
  const pag = paginacao(url);
  const r = await listarAutos(u, { municipio_id: parametro(url, "municipio"), status: parametro(url, "status"), penalidade: parametro(url, "penalidade") }, pag);
  return NextResponse.json({ ...r, page: pag.page, size: pag.size });
});

// POST /api/v1/autos-infracao – lavra o auto (numeração AI-{MUN}-000/ANO) e tenta emitir o PDF
export const POST = rota(async (req: Request) => {
  const u = await usuarioApi();
  const d = AutoInfracaoSchema.parse(await req.json());
  const r = await criarAutoInfracao(u, d);
  return NextResponse.json({ id: r.auto.id, numero: r.auto.numero, documento_id: r.documento_id, erro_pdf: r.erro_pdf }, { status: 201 });
});
