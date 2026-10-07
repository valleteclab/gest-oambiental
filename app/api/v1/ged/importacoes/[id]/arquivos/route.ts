import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerCorpoLimitado, tamanhoDeclarado } from "@/lib/ged/importacao/corpo";
import { receberArquivoPasta, registrarArquivoRejeitado } from "@/lib/ged/importacao/envio";
import { LIMITES_PADRAO } from "@/lib/ged/importacao/limites";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/v1/ged/importacoes/{id}/arquivos – UM arquivo da pasta. Corpo = bytes do arquivo (application/octet-stream).
// Cabeçalhos: X-Caminho (caminho relativo, percent-encoded; ou ?caminho=), X-Sha256 (opcional; confere a integridade do envio).
// Idempotente por caminho (retentativa/retomada não duplica). Só PDF e ZIP são guardados; outros formatos viram "Ignorado".
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const url = new URL(req.url);
  const bruto = req.headers.get("x-caminho");
  let caminho: string;
  try {
    caminho = bruto ? decodeURIComponent(bruto) : (url.searchParams.get("caminho") ?? "");
  } catch {
    throw invalido("Caminho do arquivo inválido.");
  }
  if (!caminho) throw invalido("Informe o caminho do arquivo (cabeçalho X-Caminho).");
  const declarado = tamanhoDeclarado(req);
  if (Number.isFinite(declarado) && declarado > LIMITES_PADRAO.maxArquivoBytes + 4096) {
    const r = await registrarArquivoRejeitado(ctx, id, caminho, `Arquivo excede o limite de ${Math.round(LIMITES_PADRAO.maxArquivoBytes / 1048576)} MB.`, declarado);
    return NextResponse.json(r);
  }
  const dados = await lerCorpoLimitado(req, LIMITES_PADRAO.maxArquivoBytes + 4096);
  const r = await receberArquivoPasta(ctx, id, { caminho, dados, sha256: req.headers.get("x-sha256") });
  return NextResponse.json(r, { status: r.status === "RECEBIDO" && !r.repetido ? 201 : 200 });
});
