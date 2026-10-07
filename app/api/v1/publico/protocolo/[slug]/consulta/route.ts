import { z } from "zod";
import { invalido, naoEncontrado, rota } from "@/lib/http";
import { ipDaRequisicao } from "@/lib/limite-login";
import { exigirConsultaPermitida, registrarConsultaSemResultado } from "@/lib/ged/protocolo/limites";
import { jsonPublico } from "@/lib/ged/protocolo/http-publico";
import { carregarPortal, consultarPublico } from "@/lib/ged/protocolo/publico";
import { lerNumeroProtocolo } from "@/lib/ged/protocolo/regras";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

const zCorpo = z.object({ numero: z.string().trim().max(40), codigo: z.string().trim().max(40) });

// POST { numero, codigo } → situação e andamento PÚBLICOS (sem dado pessoal, anexo nem despacho interno).
// Número/código errados = 404 genérico; falhas repetidas bloqueiam o IP e o protocolo-alvo por alguns minutos (429).
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const { slug } = await params;
  const portal = await carregarPortal(slug);
  if (!portal) throw naoEncontrado("Serviço indisponível.");
  const corpo = zCorpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) throw invalido("Informe o número do protocolo e o código de consulta.");
  const ip = ipDaRequisicao(req.headers);
  const numero = lerNumeroProtocolo(corpo.data.numero)?.numero ?? null;
  exigirConsultaPermitida(ip, portal.organizacao_id, numero);
  const c = await consultarPublico(portal, corpo.data.numero, corpo.data.codigo);
  if (!c) {
    registrarConsultaSemResultado(ip, portal.organizacao_id, numero);
    throw naoEncontrado("Protocolo não encontrado. Confira o número e o código de consulta.");
  }
  return jsonPublico(c);
});
