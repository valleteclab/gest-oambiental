import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerFiltros } from "@/lib/ged/documentos/filtros";
import { listarDocumentos } from "@/lib/ged/documentos/listar";
import { criarDocumentoUpload } from "@/lib/ged/documentos/servico";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/documentos?q=&titulo=&remetente=&de=&ate=&tipo=&status=&pasta=&marcador=&sens=&pessoais=1&arquivados=1&ordem=campo:dir&page=&size=
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const f = lerFiltros(new URL(req.url).searchParams);
  const r = await listarDocumentos(ctx, f);
  return NextResponse.json({
    data: r.linhas.map((l) => ({ ...l, data_documento: l.data_documento ? l.data_documento.toISOString().slice(0, 10) : null })),
    page: r.page,
    size: r.size,
    total: r.total,
    truncado: r.truncado,
  });
});

// POST /api/v1/ged/documentos (multipart/form-data) – arquivo (PDF) + titulo, tipo_id, remetente, data_documento, pasta_id, sensibilidade, marcador_ids (repetido)
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!form || !(arquivo instanceof File)) throw invalido("Envie o arquivo PDF no campo \"arquivo\".");
  const txt = (k: string) => (form.get(k) === null ? undefined : String(form.get(k)));
  const r = await criarDocumentoUpload(ctx, {
    titulo: txt("titulo") ?? "",
    tipo_id: txt("tipo_id"),
    remetente: txt("remetente"),
    data_documento: txt("data_documento"),
    pasta_id: txt("pasta_id"),
    sensibilidade: txt("sensibilidade") as never,
    marcador_ids: form.getAll("marcador_ids").map(String).filter(Boolean),
    arquivo: Buffer.from(await arquivo.arrayBuffer()),
    nome_arquivo: arquivo.name,
    mime: arquivo.type,
  });
  return NextResponse.json(r, { status: 201 });
});
