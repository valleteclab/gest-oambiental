import { rota } from "@/lib/http";
import { jsonCompartilhado, metaDaRequisicao } from "@/lib/ged/compartilhamento/http";
import { exigirVolumePermitido, registrarTokenRuim } from "@/lib/ged/compartilhamento/limites";
import { carregarLinkPublico, linkInvalido, solicitarOtp } from "@/lib/ged/compartilhamento/publico";

export const dynamic = "force-dynamic";

// POST /api/v1/publico/compartilhado/:token/otp – envia o código de 6 dígitos ao WhatsApp cadastrado por QUEM COMPARTILHOU.
// O destinatário não informa número nenhum. A resposta nunca revela o número (só os 2 últimos dígitos). Link inválido = 404 genérico.
export const POST = rota(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const meta = metaDaRequisicao(req.headers);
  exigirVolumePermitido(meta.ip);
  const l = await carregarLinkPublico(token);
  if (!l) {
    registrarTokenRuim(meta.ip);
    throw linkInvalido();
  }
  const r = await solicitarOtp(l, meta);
  return jsonCompartilhado({ ok: true, mensagem: `Se o link for válido, enviamos o código para o número terminado em ${r.terminacao}.`, terminacao: r.terminacao, reenvio_em_s: r.reenvio_em_s, validade_min: r.validade_min });
});
