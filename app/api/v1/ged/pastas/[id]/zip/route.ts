import { Readable } from "node:stream";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarStreamZip, planejarExportacaoPasta } from "@/lib/ged/exportacao-pasta/servico";
import { cabecalhoDisposicao } from "@/lib/ged/documentos/arquivo-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

// GET /api/v1/ged/pastas/:id/zip?versao=atual|original – baixa a pasta e as subpastas visíveis em ZIP (STORE, streaming, ZIP64).
// Permissão: VER na pasta; só entram documentos com VER (os demais ficam no MANIFESTO.csv como "omitido: sem permissao").
// 404 para pasta de outro cliente/sem acesso; 422 acima de 20.000 documentos (dividir por subpasta). Sem Content-Length
// (chunked): bytes saem continuamente, o que mantém a conexão viva atrás do proxy.
export const GET = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const versao = new URL(req.url).searchParams.get("versao");
  const plano = await planejarExportacaoPasta(ctx, id, { modo: versao === "original" ? "original" : "atual" });
  const zip = await criarStreamZip(ctx, plano);
  return new Response(Readable.toWeb(zip) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": cabecalhoDisposicao("attachment", plano.nomeZip),
      "Cache-Control": "private, no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "X-Accel-Buffering": "no",
      "X-Ged-Documentos": String(plano.entradas.length),
      "X-Ged-Omitidos": String(plano.omitidos),
    },
  });
});
