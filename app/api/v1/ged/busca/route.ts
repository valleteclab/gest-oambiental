import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerFiltros } from "@/lib/ged/documentos/filtros";
import { listarDocumentos } from "@/lib/ged/documentos/listar";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/busca?q=texto&page=&size= – busca no conteúdo dos arquivos (com trechos). Aceita os mesmos filtros de /documentos.
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const f = lerFiltros(new URL(req.url).searchParams);
  if (!f.q) throw invalido("Informe o texto a buscar (parâmetro q).");
  const r = await listarDocumentos(ctx, f);
  return NextResponse.json({
    data: r.linhas.map((l) => ({ id: l.id, numero: l.numero, titulo: l.titulo, status: l.status, sensibilidade: l.sensibilidade, trechos: l.trechos })),
    page: r.page,
    size: r.size,
    total: r.total,
    truncado: r.truncado,
  });
});
