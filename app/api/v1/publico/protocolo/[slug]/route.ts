import { naoEncontrado, rota } from "@/lib/http";
import { ipDaRequisicao } from "@/lib/limite-login";
import { exigirEnvioPermitido } from "@/lib/ged/protocolo/limites";
import { exigirTamanhoCorpo, jsonPublico, lerFormularioPortal } from "@/lib/ged/protocolo/http-publico";
import { carregarPortal, protocolarPeloPortal } from "@/lib/ged/protocolo/publico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

const INDISPONIVEL = "Serviço indisponível.";

// GET → dados públicos do portal (nome do órgão, orientação, assuntos e limites). 404 se o slug não existe OU o portal está desligado.
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const { slug } = await params;
  const portal = await carregarPortal(slug);
  if (!portal) throw naoEncontrado(INDISPONIVEL);
  return jsonPublico({ organizacao: portal.organizacao.nome, orientacao: portal.orientacao, assuntos: portal.assuntos, limites: portal.limites });
});

// POST (multipart/form-data) → protocola. Campos: nome, cpf_cnpj, email, telefone?, assunto_id, descricao, aceite_lgpd, website (isca: deve ficar vazio),
// arquivos (PDF, repetido). Limite por IP/portal; robô (isca preenchida) recebe sucesso genérico sem criar nada.
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const { slug } = await params;
  const portal = await carregarPortal(slug);
  if (!portal) throw naoEncontrado(INDISPONIVEL);
  exigirEnvioPermitido(ipDaRequisicao(req.headers), portal.organizacao_id);
  exigirTamanhoCorpo(req, portal.limites.max_anexos * portal.limites.max_bytes + 2 * 1024 * 1024);
  const { campos, arquivos } = await lerFormularioPortal(req);
  const r = await protocolarPeloPortal(portal, campos, arquivos);
  if (r.robo) return jsonPublico({ recebido: true }, 200);
  const q = `numero=${encodeURIComponent(r.numero)}&codigo=${encodeURIComponent(r.codigo_consulta)}`;
  return jsonPublico({
    recebido: true, numero: r.numero, codigo_consulta: r.codigo_consulta, registrado_em: r.registrado_em, anexos: r.anexos,
    comprovante_url: r.comprovante_disponivel ? `/api/v1/publico/protocolo/${slug}/comprovante?${q}` : null,
    consulta_url: `/protocolo/${slug}/consulta?${q}`,
  }, 201);
});
