import "server-only";
import type { Prisma, StatusProcesso } from "@prisma/client";
import { prisma } from "../db";
import { whereProcessoEscopo, type UsuarioSessao } from "../rbac";
import { UUID_RE } from "../processo/consultas";
import { SIGLAS_DEMANDAS, ehDemandaUrbana } from "./catalogo";

// Consultas das demandas urbanas: catálogo público do órgão (/servicos) e fila interna (/demandas) – sempre com escopo.

/** Serviços urbanos (tipos de ato APC/ASE/ACS ATIVOS) da organização do órgão, com documentos exigidos. */
export async function servicosDoOrgao(municipioId: string) {
  const m = await prisma.municipio.findFirst({ where: { id: municipioId, ativo: true }, select: { organizacao_id: true } });
  if (!m) return [];
  const tipos = await prisma.tipoAto.findMany({
    where: { organizacao_id: m.organizacao_id, ativo: true, sigla: { in: [...SIGLAS_DEMANDAS] } },
    select: {
      id: true, sigla: true, nome: true, validade_meses_padrao: true, prazo_analise_dias: true, exige_vistoria: true,
      documentos_exigidos: { where: { tipologia_id: null }, select: { nome: true, obrigatorio: true }, orderBy: [{ obrigatorio: "desc" }, { created_at: "asc" }] },
    },
  });
  return SIGLAS_DEMANDAS.map((s) => tipos.find((t) => t.sigla === s)).filter((t): t is (typeof tipos)[number] => !!t);
}

export type FiltroDemandas = { municipio?: string | null; sigla?: string | null; situacao?: "ativas" | "concluidas" | "todas"; tecnico?: string | null; q?: string | null; skip?: number; take?: number };

const ATIVOS: StatusProcesso[] = ["PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO", "DEFERIDO", "INDEFERIDO"];

export function whereDemandas(u: UsuarioSessao, f: FiltroDemandas): Prisma.ProcessoWhereInput {
  const and: Prisma.ProcessoWhereInput[] = [
    whereProcessoEscopo(u, f.municipio && UUID_RE.test(f.municipio) ? f.municipio : null) as Prisma.ProcessoWhereInput,
    { tipo_ato: { sigla: ehDemandaUrbana(f.sigla) ? f.sigla : { in: [...SIGLAS_DEMANDAS] } } },
  ];
  if (f.situacao === "concluidas") and.push({ status: { in: ["CONCLUIDO", "ARQUIVADO"] } });
  else if (f.situacao === "todas") and.push({ status: { not: "RASCUNHO" } });
  else and.push({ status: { in: ATIVOS } });
  if (f.tecnico === "sem") and.push({ tecnico_id: null });
  else if (f.tecnico && UUID_RE.test(f.tecnico)) and.push({ tecnico_id: f.tecnico });
  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { numero: { contains: q, mode: "insensitive" } },
        { empreendimento: { nome: { contains: q, mode: "insensitive" } } },
        { requerente: { nome: { contains: q, mode: "insensitive" } } },
        { descricao_atividade: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

export async function listarDemandas(u: UsuarioSessao, f: FiltroDemandas) {
  const where = whereDemandas(u, f);
  const [total, itens, porSigla] = await Promise.all([
    prisma.processo.count({ where }),
    prisma.processo.findMany({
      where,
      select: {
        id: true, numero: true, status: true, data_protocolo: true, prazo_etapa_ate: true, prazo_pausado: true, etapa_atual: true, descricao_atividade: true,
        municipio: { select: { id: true, nome: true, sigla: true } },
        tipo_ato: { select: { sigla: true, nome: true } },
        empreendimento: { select: { nome: true, endereco: true } },
        requerente: { select: { nome: true } },
        tecnico: { select: { id: true, nome: true } },
      },
      orderBy: [{ prazo_etapa_ate: { sort: "asc", nulls: "last" } }, { data_protocolo: "asc" }],
      skip: f.skip ?? 0,
      take: f.take ?? 30,
    }),
    // contagem por serviço (mesmos filtros, exceto o próprio serviço) – chips do topo
    prisma.processo.groupBy({ by: ["tipo_ato_id"], where: whereDemandas(u, { ...f, sigla: null }), _count: true }),
  ]);
  const tipos = porSigla.length ? await prisma.tipoAto.findMany({ where: { id: { in: porSigla.map((x) => x.tipo_ato_id) } }, select: { id: true, sigla: true } }) : [];
  const contagem: Record<string, number> = {};
  for (const g of porSigla) {
    const s = tipos.find((t) => t.id === g.tipo_ato_id)?.sigla;
    if (s) contagem[s] = (contagem[s] ?? 0) + g._count;
  }
  return { total, itens, contagem };
}
