import { rota } from "@/lib/http";
import { cookiesSessao, conexaoSegura, jsonCompartilhado, lerCookieSessao, metaDaRequisicao } from "@/lib/ged/compartilhamento/http";
import { exigirVolumePermitido } from "@/lib/ged/compartilhamento/limites";
import { carregarLinkPublico, encerrarSessao } from "@/lib/ged/compartilhamento/publico";

export const dynamic = "force-dynamic";

// POST /api/v1/publico/compartilhado/:token/sair – encerra a sessão (o cookie é apagado; sempre 200, sem revelar se o link existe).
export const POST = rota(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const meta = metaDaRequisicao(req.headers);
  exigirVolumePermitido(meta.ip);
  const l = await carregarLinkPublico(token);
  if (l) await encerrarSessao(l, lerCookieSessao(req.headers), meta);
  return jsonCompartilhado({ ok: true }, 200, { "Set-Cookie": cookiesSessao(token, null, conexaoSegura(req)) });
});
