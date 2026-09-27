import { NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { naoAutenticado, rota } from "@/lib/http";
import { isInterno } from "@/lib/rbac";
import { statusAmigavel } from "@/components/ui";
import { acoesDoProcesso, obterProcessoAutorizado } from "@/lib/processo/consultas";

/** GET /api/v1/processos/{id} – detalhe (requerente recebe visão reduzida, sem despachos internos). */
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const p = await obterProcessoAutorizado(id, u);
  const interno = isInterno(u);
  const [tramitacoes, pendencias, anexos, documentos, pareceres, condicionantes] = await Promise.all([
    prisma.tramitacao.findMany({ where: { processo_id: p.id, ...(interno ? {} : { publico: true }) }, orderBy: { created_at: "asc" } }),
    prisma.pendencia.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" } }),
    prisma.anexo.findMany({ where: { processo_id: p.id }, select: { id: true, tipo: true, nome_arquivo: true, mime: true, tamanho: true, sha256: true, documento_exigido_id: true, pendencia_id: true, created_at: true }, orderBy: { created_at: "asc" } }),
    prisma.documentoOficial.findMany({ where: { processo_id: p.id }, select: { id: true, tipo: true, numero: true, codigo_verificador: true, status: true, emitido_em: true, validade_ate: true }, orderBy: { emitido_em: "asc" } }),
    interno ? prisma.parecer.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" } }) : Promise.resolve([]),
    prisma.condicionante.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" } }),
  ]);
  return NextResponse.json({
    id: p.id,
    numero: p.numero,
    status: interno ? p.status : undefined,
    status_amigavel: statusAmigavel(p.status),
    etapa_atual: p.etapa_atual,
    data_protocolo: p.data_protocolo,
    data_conclusao: p.data_conclusao,
    prazo_etapa_ate: interno ? p.prazo_etapa_ate : undefined,
    prazo_pausado: p.prazo_pausado,
    municipio: { id: p.municipio.id, nome: p.municipio.nome, sigla: p.municipio.sigla },
    tipo_ato: { id: p.tipo_ato.id, sigla: p.tipo_ato.sigla, nome: p.tipo_ato.nome },
    empreendimento: { id: p.empreendimento.id, nome: p.empreendimento.nome, porte: p.empreendimento.porte, tipologia: p.empreendimento.tipologia.descricao, latitude: p.empreendimento.latitude, longitude: p.empreendimento.longitude },
    requerente: p.requerente,
    tecnico: interno ? p.tecnico : undefined,
    descricao_atividade: p.descricao_atividade,
    tramitacoes: tramitacoes.map((t) => ({ id: t.id, acao: t.acao, de_status: interno ? t.de_status : undefined, para_status: interno ? t.para_status : undefined, status_amigavel: statusAmigavel(t.para_status), despacho: interno ? t.despacho : undefined, created_at: t.created_at })),
    pendencias,
    anexos,
    documentos,
    pareceres,
    condicionantes,
    acoes_disponiveis: acoesDoProcesso(p, u),
  });
});
