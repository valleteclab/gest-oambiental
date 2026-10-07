import { invalido, rota } from "@/lib/http";
import { cookiesSessao, conexaoSegura, jsonCompartilhado, metaDaRequisicao } from "@/lib/ged/compartilhamento/http";
import { exigirVolumePermitido, registrarTokenRuim } from "@/lib/ged/compartilhamento/limites";
import { carregarLinkPublico, linkInvalido, validarOtp } from "@/lib/ged/compartilhamento/publico";
import { zValidarOtp } from "@/lib/ged/compartilhamento/regras";

export const dynamic = "force-dynamic";

// POST /api/v1/publico/compartilhado/:token/validar  { codigo } – confere o OTP (uso único, 10 min, 5 tentativas) e abre a sessão:
// cookie httpOnly com escopo de caminho deste link, 30 min deslizantes (teto 2 h), preso ao navegador.
export const POST = rota(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const meta = metaDaRequisicao(req.headers);
  exigirVolumePermitido(meta.ip);
  const l = await carregarLinkPublico(token);
  if (!l) {
    registrarTokenRuim(meta.ip);
    throw linkInvalido();
  }
  const corpo = zValidarOtp.safeParse(await req.json().catch(() => null));
  if (!corpo.success) throw invalido("Informe o código de 6 dígitos.");
  const r = await validarOtp(l, corpo.data.codigo, meta);
  return jsonCompartilhado({ ok: true }, 200, { "Set-Cookie": cookiesSessao(token, r.sessao_token, conexaoSegura(req)) });
});
