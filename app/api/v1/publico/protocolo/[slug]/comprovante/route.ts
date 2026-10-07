import { naoEncontrado, rota } from "@/lib/http";
import { ipDaRequisicao } from "@/lib/limite-login";
import { cabecalhosArquivo } from "@/lib/ged/documentos/arquivo-http";
import { exigirConsultaPermitida, registrarConsultaSemResultado } from "@/lib/ged/protocolo/limites";
import { CABECALHOS_PUBLICOS } from "@/lib/ged/protocolo/http-publico";
import { carregarPortal, comprovantePublico } from "@/lib/ged/protocolo/publico";
import { lerNumeroProtocolo } from "@/lib/ged/protocolo/regras";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

// GET ?numero=&codigo= → PDF do comprovante (só com o número E o código de consulta). 404 genérico se não conferir.
export const GET = rota(async (req: Request, { params }: Ctx) => {
  const { slug } = await params;
  const portal = await carregarPortal(slug);
  if (!portal) throw naoEncontrado("Serviço indisponível.");
  const u = new URL(req.url);
  const numeroBruto = u.searchParams.get("numero") ?? "";
  const numero = lerNumeroProtocolo(numeroBruto)?.numero ?? null;
  const ip = ipDaRequisicao(req.headers);
  exigirConsultaPermitida(ip, portal.organizacao_id, numero);
  const c = await comprovantePublico(portal, numeroBruto, u.searchParams.get("codigo") ?? "");
  if (!c) {
    registrarConsultaSemResultado(ip, portal.organizacao_id, numero);
    throw naoEncontrado("Comprovante não encontrado. Confira o número e o código de consulta.");
  }
  return new Response(new Uint8Array(c.buffer), { headers: { ...cabecalhosArquivo({ mime: "application/pdf", tamanho: c.buffer.length, sha256: c.sha256, tipo: "attachment", nome: c.nome }), ...CABECALHOS_PUBLICOS } });
});
