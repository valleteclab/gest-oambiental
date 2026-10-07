import { rota } from "@/lib/http";
import { jsonCompartilhado, lerCookieSessao, metaDaRequisicao } from "@/lib/ged/compartilhamento/http";
import { exigirVolumePermitido, registrarTokenRuim } from "@/lib/ged/compartilhamento/limites";
import { carregarLinkPublico, exigirSessao, linkInvalido, visaoPublica } from "@/lib/ged/compartilhamento/publico";

export const dynamic = "force-dynamic";

// GET /api/v1/publico/compartilhado/:token/itens?pasta=<id> – pastas e documentos PERMITIDOS agora (recalculado a cada chamada). Exige sessão.
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
  return jsonCompartilhado(await visaoPublica(l, escopo, pasta && /^[0-9a-f-]{36}$/i.test(pasta) ? pasta : null));
});
