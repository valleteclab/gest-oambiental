import { NextResponse } from "next/server";
import type { EstadoConversa, TipoCanal } from "@prisma/client";
import { paginacao, proibido, rota } from "@/lib/http";
import { usuarioApi, enumOuNulo, parametro } from "@/lib/fiscalizacao/api";
import { listarConversas, podeVerAtendimento } from "@/lib/agente/atendimento";

export const dynamic = "force-dynamic";
const ESTADOS: EstadoConversa[] = ["INICIO", "AGUARDANDO_LGPD", "COLETANDO", "CONFIRMANDO", "REGISTRADA", "HUMANO", "ENCERRADA"];
const CANAIS: TipoCanal[] = ["WHATSAPP_ZAPI", "WHATSAPP_EVOLUTION", "WHATSAPP_CHATWOOT", "WEBCHAT", "EMAIL"];

// GET /api/v1/atendimento/conversas?municipio_id=&estado=&canal=&page=&size=
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi("denuncia");
  if (!podeVerAtendimento(u)) throw proibido();
  const url = new URL(req.url);
  const p = paginacao(url);
  const r = await listarConversas(u, { municipio_id: parametro(url, "municipio_id"), estado: enumOuNulo(parametro(url, "estado"), ESTADOS), canal: enumOuNulo(parametro(url, "canal"), CANAIS) }, p);
  return NextResponse.json({ page: p.page, size: p.size, total: r.total, itens: r.itens });
});
