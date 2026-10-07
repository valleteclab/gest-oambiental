import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { montarCsv } from "@/lib/ged/logs/csv";
import { lerEntradaExclusao, respostaInicio } from "@/lib/ged/exclusao/http";
import { iniciarExclusao } from "@/lib/ged/exclusao/servico";
import { cancelarEnvio } from "@/lib/ged/importacao/envio";
import { listarItensImportacao, obterImportacao } from "@/lib/ged/importacao/servico";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/importacoes/{id}?status=ERRO&page=&size=  → lote + itens do relatório (outro cliente → 404)
// GET /api/v1/ged/importacoes/{id}?formato=csv           → relatório completo em CSV
export const GET = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const url = new URL(req.url);
  const lote = await obterImportacao(ctx, id);
  if (url.searchParams.get("formato") === "csv") {
    const linhas: unknown[][] = [];
    for (let page = 1; ; page++) {
      const r = await listarItensImportacao(ctx, id, { page, size: 500 });
      linhas.push(...r.itens.map((i) => [i.ordem + 1, i.caminho, i.status, i.motivo ?? ""]));
      if (page * 500 >= r.total) break;
    }
    return new Response(montarCsv(["#", "Caminho", "Situação", "Motivo"], linhas), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="importacao-${id.slice(0, 8)}.csv"` },
    });
  }
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const size = Math.min(500, Math.max(1, Number(url.searchParams.get("size") ?? 50)));
  const r = await listarItensImportacao(ctx, id, { status: url.searchParams.get("status"), page, size });
  return NextResponse.json({ ...lote, itens: r.itens, itens_total: r.total, page: r.page, size: r.size });
});

// DELETE /api/v1/ged/importacoes/{id} – cancela um lote que ainda está RECEBENDO (descarta o que foi enviado).
// DELETE /api/v1/ged/importacoes/{id}?documentos=true  { confirmacao: "EXCLUIR", apenas_possiveis? } – EXCLUI os documentos que o lote
// importou e as pastas que ele criou e ficaram vazias (equivale a POST …/excluir; pré-visualização: GET …/excluir).
export const DELETE = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  if (new URL(req.url).searchParams.get("documentos") === "true") return respostaInicio(await iniciarExclusao(ctx, { tipo: "IMPORTACAO", id }, await lerEntradaExclusao(req)));
  await cancelarEnvio(ctx, id);
  return new Response(null, { status: 204 });
});
