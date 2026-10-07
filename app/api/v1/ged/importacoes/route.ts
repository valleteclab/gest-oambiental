import { NextResponse } from "next/server";
import { ErroApi, invalido, paginacao, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { MAX_ZIP_SIMPLES } from "@/lib/ged/importacao/limites";
import { criarImportacao, iniciarImportacaoAposEnvio, listarImportacoes } from "@/lib/ged/importacao/servico";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/v1/ged/importacoes?page=&size=  (Admin: todos os lotes do cliente; Gestor: os que ele enviou)
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const { page, size } = paginacao(new URL(req.url));
  const r = await listarImportacoes(ctx, { page, size });
  return NextResponse.json({ data: r.linhas, page: r.page, size: r.size, total: r.total });
});

// POST /api/v1/ged/importacoes (multipart/form-data) – arquivo (.zip, até 64 MB) + pasta_id?, tipo_id?, sensibilidade?, unir_pastas?
// ZIP maior: POST …/zip-partes (em partes). Pasta: POST …/pasta + …/{id}/arquivos.
// Valida o ZIP (limites/zip-slip), grava e registra o lote PENDENTE; o job `ged-importar` processa em segundo plano.
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const declarado = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declarado) && declarado > MAX_ZIP_SIMPLES + 1048576) throw new ErroApi(413, "CORPO_GRANDE", `Este envio aceita ZIP de até ${Math.round(MAX_ZIP_SIMPLES / 1048576)} MB; ZIPs maiores são enviados em partes (a tela faz isso sozinha).`);
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!form || !(arquivo instanceof File)) throw invalido("Envie o arquivo ZIP no campo \"arquivo\".");
  const txt = (k: string) => (form.get(k) === null ? undefined : String(form.get(k)));
  const r = await criarImportacao(ctx, {
    nome_arquivo: arquivo.name,
    arquivo: Buffer.from(await arquivo.arrayBuffer()),
    pasta_id: txt("pasta_id"),
    tipo_id: txt("tipo_id"),
    sensibilidade: txt("sensibilidade"),
    unir_pastas: txt("unir_pastas") === "true",
  });
  const via = await iniciarImportacaoAposEnvio(ctx.organizacao_id, r.id);
  return NextResponse.json({ ...r, via }, { status: 201 });
});
