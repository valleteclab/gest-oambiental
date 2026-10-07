import { NextResponse } from "next/server";
import { paginacao, rota } from "@/lib/http";
import { enumOuNulo, lerCorpoComFotos, parametro, usuarioApi } from "@/lib/fiscalizacao/api";
import { FiscalizacaoSchema } from "@/lib/fiscalizacao/schemas";
import { criarFiscalizacao, listarFiscalizacoes } from "@/lib/fiscalizacao/servico";

// GET /api/v1/fiscalizacoes?municipio=&constatacao=&origem=&q=&page=&size=
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi();
  const url = new URL(req.url);
  const pag = paginacao(url);
  const r = await listarFiscalizacoes(u, {
    municipio_id: parametro(url, "municipio"),
    constatacao: enumOuNulo(parametro(url, "constatacao"), ["IRREGULAR", "REGULAR", "INCONCLUSIVA"] as const),
    origem: enumOuNulo(parametro(url, "origem"), ["DENUNCIA", "PROCESSO", "ROTINA"] as const),
    q: parametro(url, "q"),
  }, pag);
  return NextResponse.json({ ...r, page: pag.page, size: pag.size });
});

// POST /api/v1/fiscalizacoes – JSON ou multipart (dados=JSON, fotos=arquivos, fotos_meta=JSON)
export const POST = rota(async (req: Request) => {
  const u = await usuarioApi();
  const { dados, fotos } = await lerCorpoComFotos(req);
  const d = FiscalizacaoSchema.parse(dados);
  const f = await criarFiscalizacao(u, d, fotos);
  return NextResponse.json({ id: f.id, municipio_id: f.municipio_id, origem: f.origem, fotos: fotos.length }, { status: 201 });
});
