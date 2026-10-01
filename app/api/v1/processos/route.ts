import { NextResponse } from "next/server";
import type { StatusProcesso } from "@prisma/client";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, paginacao, proibido, rota } from "@/lib/http";
import { can, isInterno } from "@/lib/rbac";
import { statusAmigavel } from "@/components/ui";
import { listarProcessos } from "@/lib/processo/consultas";
import { salvarRascunho } from "@/lib/processo/rascunho";

const STATUS = ["RASCUNHO", "PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO", "DEFERIDO", "INDEFERIDO", "CONCLUIDO", "ARQUIVADO"];

/** GET /api/v1/processos?municipio=&status=&tipo=&tecnico=&q=&page=&size= (escopo aplicado no servidor) */
export const GET = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!can(u, "ver", "processo")) throw proibido();
  const url = new URL(req.url);
  const pg = paginacao(url);
  const s = url.searchParams;
  const status = s.get("status");
  const { total, itens } = await listarProcessos(u, {
    municipio: s.get("municipio"),
    status: status && STATUS.includes(status) ? (status as StatusProcesso) : null,
    tipo: s.get("tipo"),
    tecnico: s.get("tecnico"),
    q: s.get("q"),
    incluirRascunhos: !isInterno(u),
    skip: pg.skip,
    take: pg.take,
    ordenarPorPrazo: s.get("ordem") === "prazo",
  });
  const interno = isInterno(u);
  return NextResponse.json({
    page: pg.page,
    size: pg.size,
    total,
    items: itens.map((p) => ({ ...p, status: interno ? p.status : undefined, status_amigavel: statusAmigavel(p.status), tecnico: interno ? p.tecnico : undefined })),
  });
});

/** POST /api/v1/processos – cria rascunho de requerimento (protocolar via /acoes/protocolar). */
export const POST = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const corpo = await req.json();
  const p = await salvarRascunho(corpo, u);
  return NextResponse.json({ id: p.id, status: p.status, municipio_id: p.municipio_id, empreendimento_id: p.empreendimento_id, tipo_ato_id: p.tipo_ato_id }, { status: corpo?.processo_id ? 200 : 201 });
});
