import { Readable } from "node:stream";
import { rota } from "@/lib/http";
import { cabecalhoDisposicao } from "@/lib/ged/documentos/arquivo-http";
import { lerCookieSessao, metaDaRequisicao } from "@/lib/ged/compartilhamento/http";
import { exigirVolumePermitido, registrarTokenRuim } from "@/lib/ged/compartilhamento/limites";
import { carregarLinkPublico, entregarZip, exigirSessao, linkInvalido } from "@/lib/ged/compartilhamento/publico";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

// GET /api/v1/publico/compartilhado/:token/zip?pasta=<id> – a pasta do link (ou subpasta) em ZIP, em streaming, só com o conjunto permitido.
// Exige sessão e a permissão de ZIP do link. O ZIP é interrompido se o link for revogado durante o download.
export const GET = rota(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const meta = metaDaRequisicao(req.headers);
  exigirVolumePermitido(meta.ip);
  const l = await carregarLinkPublico(token);
  if (!l) {
    registrarTokenRuim(meta.ip);
    throw linkInvalido();
  }
  const escopo = await exigirSessao(l, lerCookieSessao(req.headers), meta);
  const pasta = new URL(req.url).searchParams.get("pasta");
  const z = await entregarZip(l, escopo, pasta && /^[0-9a-f-]{36}$/i.test(pasta) ? pasta : null, meta);
  return new Response(Readable.toWeb(z.stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": cabecalhoDisposicao("attachment", z.nome),
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Accel-Buffering": "no",
    },
  });
});
