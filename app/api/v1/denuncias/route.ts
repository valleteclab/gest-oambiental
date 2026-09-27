import { NextResponse } from "next/server";
import { paginacao, rota } from "@/lib/http";
import { enumOuNulo, parametro, usuarioApi } from "@/lib/fiscalizacao/api";
import { DenunciaInternaSchema } from "@/lib/fiscalizacao/schemas";
import { criarDenunciaInterna, listarDenuncias } from "@/lib/fiscalizacao/servico";

const STATUS = ["NOVA", "EM_APURACAO", "CONCLUIDA", "ARQUIVADA"] as const;

// GET /api/v1/denuncias?municipio=&status=&q=&page=&size=
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi("denuncia");
  const url = new URL(req.url);
  const pag = paginacao(url);
  const r = await listarDenuncias(u, { municipio_id: parametro(url, "municipio"), status: enumOuNulo(parametro(url, "status"), STATUS), q: parametro(url, "q") }, pag);
  return NextResponse.json({ ...r, page: pag.page, size: pag.size });
});

// POST /api/v1/denuncias – registro interno (presencial/telefone/outro)
export const POST = rota(async (req: Request) => {
  const u = await usuarioApi("denuncia");
  const d = DenunciaInternaSchema.parse(await req.json());
  return NextResponse.json(await criarDenunciaInterna(u, d), { status: 201 });
});
