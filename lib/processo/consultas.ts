import "server-only";
import type { Prisma, StatusProcesso } from "@prisma/client";
import { prisma } from "../db";
import { naoEncontrado, proibido } from "../http";
import { can, isInterno, podeVerMunicipio, whereProcessoEscopo, type UsuarioSessao } from "../rbac";
import { acoesDisponiveis, ehTitular, type ContextoAcao } from "./maquina";
import { decisaoPeloTecnico } from "../demandas/catalogo";

// Consultas de processo sempre com escopo (SPEC 4.1): interno por município, requerente por titularidade.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pode ver este processo? (checa escopo; use antes de exibir por URL direta → 403) */
export function podeVerProcesso(u: UsuarioSessao, p: { municipio_id: string; requerente_id: string; rt?: { pessoa_id: string } | null }): boolean {
  if (isInterno(u) && podeVerMunicipio(u, p.municipio_id) && can(u, "ver", "processo", p.municipio_id)) return true;
  return ehTitular(u, { requerente_id: p.requerente_id, rt_pessoa_id: p.rt?.pessoa_id ?? null });
}

export const INCLUDE_PROCESSO = {
  municipio: true,
  tipo_ato: { include: { checklist_modelo: true } },
  empreendimento: { include: { tipologia: true } },
  requerente: { select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true, nome_fantasia: true } },
  rt: { include: { pessoa: { select: { id: true, nome: true } } } },
  tecnico: { select: { id: true, nome: true } },
  gestor: { select: { id: true, nome: true } },
} satisfies Prisma.ProcessoInclude;

export type ProcessoCompleto = Prisma.ProcessoGetPayload<{ include: typeof INCLUDE_PROCESSO }>;

/** Carrega o processo verificando escopo. Lança 404/403 (ErroApi). */
export async function obterProcessoAutorizado(id: string, u: UsuarioSessao): Promise<ProcessoCompleto> {
  if (!UUID_RE.test(id)) throw naoEncontrado("Processo não encontrado.");
  const p = await prisma.processo.findUnique({ where: { id }, include: INCLUDE_PROCESSO });
  if (!p) throw naoEncontrado("Processo não encontrado.");
  if (!podeVerProcesso(u, p)) throw proibido("Você não tem acesso a este processo.");
  return p;
}

export function contextoAcao(p: ProcessoCompleto): ContextoAcao {
  return {
    status: p.status,
    municipio_id: p.municipio_id,
    requerente_id: p.requerente_id,
    rt_pessoa_id: p.rt?.pessoa_id ?? null,
    delega_decisao: p.municipio.delega_decisao,
    exige_parecer: p.tipo_ato.exige_parecer,
    decisao_tecnico: decisaoPeloTecnico(p.tipo_ato),
  };
}

export function acoesDoProcesso(p: ProcessoCompleto, u: UsuarioSessao) {
  return acoesDisponiveis(contextoAcao(p), u);
}

export type FiltroProcessos = {
  municipio?: string | null;
  status?: StatusProcesso | null;
  tipo?: string | null;
  tecnico?: string | null;
  q?: string | null;
  incluirRascunhos?: boolean;
  skip?: number;
  take?: number;
  ordenarPorPrazo?: boolean;
};

export function whereProcessos(u: UsuarioSessao, f: FiltroProcessos): Prisma.ProcessoWhereInput {
  const q = f.q?.trim();
  const and: Prisma.ProcessoWhereInput[] = [whereProcessoEscopo(u, f.municipio && UUID_RE.test(f.municipio) ? f.municipio : null) as Prisma.ProcessoWhereInput];
  if (f.status) and.push({ status: f.status });
  else if (!f.incluirRascunhos && isInterno(u)) and.push({ status: { not: "RASCUNHO" } });
  if (f.tipo && UUID_RE.test(f.tipo)) and.push({ tipo_ato_id: f.tipo });
  if (f.tecnico === "sem") and.push({ tecnico_id: null });
  else if (f.tecnico && UUID_RE.test(f.tecnico)) and.push({ tecnico_id: f.tecnico });
  if (q) {
    and.push({
      OR: [
        { numero: { contains: q, mode: "insensitive" } },
        { empreendimento: { nome: { contains: q, mode: "insensitive" } } },
        { requerente: { nome: { contains: q, mode: "insensitive" } } },
        { requerente: { nome_fantasia: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  return { AND: and };
}

export const SELECT_LISTA = {
  id: true,
  numero: true,
  status: true,
  data_protocolo: true,
  prazo_etapa_ate: true,
  prazo_pausado: true,
  etapa_atual: true,
  created_at: true,
  updated_at: true,
  municipio: { select: { id: true, nome: true, sigla: true } },
  tipo_ato: { select: { id: true, sigla: true, nome: true } },
  empreendimento: { select: { id: true, nome: true } },
  requerente: { select: { id: true, nome: true } },
  tecnico: { select: { id: true, nome: true } },
} satisfies Prisma.ProcessoSelect;

export async function listarProcessos(u: UsuarioSessao, f: FiltroProcessos) {
  const where = whereProcessos(u, f);
  const orderBy: Prisma.ProcessoOrderByWithRelationInput[] = f.ordenarPorPrazo
    ? [{ prazo_etapa_ate: { sort: "asc", nulls: "last" } }, { data_protocolo: "asc" }]
    : [{ updated_at: "desc" }];
  const [total, itens] = await Promise.all([
    prisma.processo.count({ where }),
    prisma.processo.findMany({ where, select: SELECT_LISTA, orderBy, skip: f.skip ?? 0, take: f.take ?? 20 }),
  ]);
  return { total, itens };
}

/** Técnicos elegíveis para distribuição no município: TEC_MUNICIPAL do município + TEC_CONSORCIO (ativos) – só da organização do município. */
export async function tecnicosElegiveis(municipioId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.usuario.findMany({
    where: { ativo: true, organizacao: { municipios: { some: { id: municipioId } } }, papeis: { some: { OR: [{ papel: "TEC_MUNICIPAL", municipio_id: municipioId }, { papel: "TEC_CONSORCIO" }] } } },
    select: { id: true, nome: true, papeis: { select: { papel: true, municipio_id: true } } },
    orderBy: { nome: "asc" },
  });
}

/** Documentos exigidos para o tipo de ato (+ específicos da tipologia do empreendimento). */
export async function documentosExigidos(tipoAtoId: string, tipologiaId: string | null) {
  return prisma.documentoExigido.findMany({
    where: { tipo_ato_id: tipoAtoId, OR: [{ tipologia_id: null }, ...(tipologiaId ? [{ tipologia_id: tipologiaId }] : [])] },
    orderBy: [{ obrigatorio: "desc" }, { created_at: "asc" }],
  });
}

/** Processos em que o usuário é requerente ou RT (área do requerente – independe de papéis internos). */
export function whereTitular(u: UsuarioSessao): Prisma.ProcessoWhereInput {
  if (!u.pessoa_id) return { id: "00000000-0000-0000-0000-000000000000" };
  return { OR: [{ requerente_id: u.pessoa_id }, { rt: { pessoa_id: u.pessoa_id } }] };
}

/** dias_alerta por etapa/município (prazo_config; município sobrepõe organização) – para o semáforo das listas. */
/** Dias de alerta por município/etapa ("*" = padrão da organização). Informe a organização do usuário (isolamento). */
export async function mapaDiasAlerta(organizacaoId?: string | null): Promise<Record<string, number>> {
  const cfgs = await prisma.prazoConfig.findMany({ where: { organizacao_id: organizacaoId ?? "00000000-0000-0000-0000-000000000000" }, select: { municipio_id: true, etapa: true, dias_alerta: true } });
  return Object.fromEntries(cfgs.map((c) => [`${c.municipio_id ?? "*"}:${c.etapa}`, c.dias_alerta]));
}

export function diasAlertaDe(mapa: Record<string, number>, municipioId: string, etapa: string | null | undefined): number {
  if (!etapa) return 5;
  return mapa[`${municipioId}:${etapa}`] ?? mapa[`*:${etapa}`] ?? 5;
}
