import { rota } from "@/lib/http";
import { cabecalhoDisposicao } from "@/lib/ged/documentos/arquivo-http";
import { lerCookieSessao, metaDaRequisicao } from "@/lib/ged/compartilhamento/http";
import { exigirVolumePermitido, registrarTokenRuim } from "@/lib/ged/compartilhamento/limites";
import { carregarLinkPublico, entregarArquivo, exigirSessao, linkInvalido } from "@/lib/ged/compartilhamento/publico";

export const dynamic = "force-dynamic";

// GET /api/v1/publico/compartilhado/:token/arquivo?doc=<id>&inline=1 – PDF para ver no navegador (inline) ou baixar (conta no limite).
// Sem cache, sem indexação, sem Referer. O documento é conferido contra o conjunto permitido A CADA requisição.
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
  const q = new URL(req.url).searchParams;
  const inline = q.get("inline") === "1";
  const arq = await entregarArquivo(l, escopo, q.get("doc") ?? "", inline, meta);
  return new Response(new Uint8Array(arq.dados), {
    headers: {
      "Content-Type": arq.mime,
      "Content-Length": String(arq.dados.length),
      "Content-Disposition": cabecalhoDisposicao(inline ? "inline" : "attachment", arq.nome),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
});
