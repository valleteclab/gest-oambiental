import "server-only";
import type { FonteAlertaDesmatamento, Prisma, StatusAlertaDesmatamento } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../audit";
import { invalido, naoEncontrado, proibido } from "../http";
import { podeVerMunicipio, whereMunicipio, type UsuarioSessao } from "../rbac";
import { extrairPoligono, type PoligonoGeo } from "../geo/validar";
import { simplificarGeometria } from "./geo";
import {
  ROTULO_FONTE, ROTULO_STATUS_ALERTA, indicadores, podeTransicionarAlerta, podeTratarAlerta, podeVerMonitoramento, type Cruzamento,
} from "./regras";

// Consultas e ações do monitoramento por satélite – escopo SEMPRE por whereMunicipio()/podeVerMunicipio() (organização/município).

export type FiltroAlertas = {
  municipio_id?: string | null;
  fonte?: string | null;
  status?: string | null;
  classe?: string | null;
  sugestao?: string | null;
  /** AAAA-MM-DD (data de detecção) */
  de?: string | null;
  ate?: string | null;
};

const FONTES = Object.keys(ROTULO_FONTE) as FonteAlertaDesmatamento[];
const STATUS = Object.keys(ROTULO_STATUS_ALERTA) as StatusAlertaDesmatamento[];
const dataOk = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);

export function whereAlertas(u: UsuarioSessao, f: FiltroAlertas): Prisma.AlertaDesmatamentoWhereInput {
  const de = dataOk(f.de);
  const ate = dataOk(f.ate);
  return {
    ...whereMunicipio(u, f.municipio_id),
    ...(f.fonte && FONTES.includes(f.fonte as FonteAlertaDesmatamento) ? { fonte: f.fonte as FonteAlertaDesmatamento } : {}),
    ...(f.status && STATUS.includes(f.status as StatusAlertaDesmatamento) ? { status: f.status as StatusAlertaDesmatamento } : {}),
    ...(f.classe ? { classe: f.classe.slice(0, 60) } : {}),
    ...(f.sugestao ? { status_sugerido: f.sugestao.slice(0, 30) } : {}),
    ...(de || ate ? { data_deteccao: { ...(de ? { gte: new Date(`${de}T00:00:00Z`) } : {}), ...(ate ? { lte: new Date(`${ate}T00:00:00Z`) } : {}) } } : {}),
  };
}

/** Geometria leve para o mapa (≤ 6 KB); falha de simplificação → só não desenha o polígono (nunca derruba a página). */
function geometriaMapa(g: unknown): PoligonoGeo | null {
  if (!g) return null;
  try {
    return simplificarGeometria(g, 6_000) ?? simplificarGeometria(g, 60_000);
  } catch {
    return null;
  }
}

type CarResumo = { imoveis?: unknown[] } | undefined;
const qtdCar = (c: unknown) => ((c as { car?: CarResumo } | null)?.car?.imoveis?.length ?? 0);

/** Lista paginada + indicadores sobre TODO o filtro + feições simplificadas para o mapa (até `limiteMapa`). */
export async function listarAlertas(u: UsuarioSessao, f: FiltroAlertas, pag: { skip: number; take: number }, limiteMapa = 1500) {
  const where = whereAlertas(u, f);
  const [total, itens, todos, classes] = await Promise.all([
    prisma.alertaDesmatamento.count({ where }),
    prisma.alertaDesmatamento.findMany({
      where, orderBy: [{ data_deteccao: "desc" }, { area_ha: "desc" }], skip: pag.skip, take: pag.take,
      select: { id: true, fonte: true, id_externo: true, classe: true, data_deteccao: true, area_ha: true, status: true, status_sugerido: true, cruzamento: true, municipio: { select: { sigla: true, nome: true } }, fiscalizacao_id: true },
    }),
    prisma.alertaDesmatamento.findMany({
      where, orderBy: { data_deteccao: "desc" }, take: 20_000,
      select: { id: true, fonte: true, id_externo: true, data_deteccao: true, area_ha: true, status: true, status_sugerido: true, cruzamento: true, geometria: true, latitude: true, longitude: true },
    }),
    prisma.alertaDesmatamento.findMany({ where: whereMunicipio(u, f.municipio_id), distinct: ["classe"], select: { classe: true }, orderBy: { classe: "asc" }, take: 100 }),
  ]);
  const kpi = indicadores(todos.map((a) => ({ area_ha: Number(a.area_ha), status: a.status, status_sugerido: a.status_sugerido, com_car: qtdCar(a.cruzamento) > 0 })));
  const feicoes = todos.slice(0, limiteMapa).map((a) => ({
    id: a.id,
    status: a.status,
    titulo: `${a.fonte} ${a.id_externo}`,
    descricao: `${a.data_deteccao.toISOString().slice(0, 10).split("-").reverse().join("/")} · ${Number(a.area_ha).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha · ${ROTULO_STATUS_ALERTA[a.status]}`,
    geometria: geometriaMapa(a.geometria),
    lat: Number(a.latitude),
    lng: Number(a.longitude),
  }));
  return {
    total,
    itens: itens.map((a) => ({ ...a, area_ha: Number(a.area_ha), imoveis_car: qtdCar(a.cruzamento), cruzamento: undefined })),
    kpi,
    feicoes,
    feicoesOmitidas: Math.max(0, todos.length - limiteMapa),
    classes: classes.map((c) => c.classe),
  };
}

/** Quantidade de alertas NOVOS no escopo (card do painel). */
export async function contarNovos(u: UsuarioSessao, municipioId?: string | null) {
  const where = { ...whereMunicipio(u, municipioId), status: "NOVO" as const };
  const [n, area] = await Promise.all([prisma.alertaDesmatamento.count({ where }), prisma.alertaDesmatamento.aggregate({ where, _sum: { area_ha: true } })]);
  return { novos: n, area_ha: Number(area._sum.area_ha ?? 0) };
}

export async function obterAlerta(u: UsuarioSessao, id: string) {
  const a = await prisma.alertaDesmatamento.findUnique({
    where: { id },
    include: {
      municipio: { select: { id: true, nome: true, sigla: true, codigo_ibge: true } },
      fiscalizacao: { select: { id: true, status: true, data_hora: true, constatacao: true } },
      denuncia: { select: { id: true, protocolo: true, status: true } },
      documento: { select: { id: true, numero: true, sigla_ato: true, tipo: true, validade_ate: true, status: true } },
    },
  });
  if (!a) throw naoEncontrado("Alerta não encontrado.");
  if (!podeVerMunicipio(u, a.municipio_id) || !podeVerMonitoramento(u, a.municipio_id)) throw proibido();
  const atualizadoPor = a.atualizado_por ? await prisma.usuario.findUnique({ where: { id: a.atualizado_por }, select: { nome: true } }) : null;
  return {
    ...a,
    area_ha: Number(a.area_ha),
    latitude: Number(a.latitude),
    longitude: Number(a.longitude),
    geometria: extrairPoligono(a.geometria) as PoligonoGeo | null,
    cruzamento: (a.cruzamento ?? null) as Cruzamento | null,
    dados_fonte: (a.dados_fonte ?? {}) as Record<string, unknown>,
    atualizado_por_nome: atualizadoPor?.nome ?? null,
  };
}

/** Licenças/autorizações VÁLIDAS do município para vincular ao marcar AUTORIZADO (as dos empreendimentos relacionados primeiro). */
export async function documentosVinculaveis(u: UsuarioSessao, municipioId: string, relacionados: string[]) {
  if (!podeVerMunicipio(u, municipioId)) return [];
  const docs = await prisma.documentoOficial.findMany({
    where: { municipio_id: municipioId, status: "VALIDO", tipo: { in: ["LICENCA", "AUTORIZACAO"] } },
    orderBy: { emitido_em: "desc" }, take: 300,
    select: { id: true, numero: true, sigla_ato: true, validade_ate: true, processo: { select: { empreendimento: { select: { id: true, nome: true } } } } },
  });
  const rel = new Set(relacionados);
  return docs
    .map((d) => ({ id: d.id, numero: d.numero, sigla_ato: d.sigla_ato, validade_ate: d.validade_ate, empreendimento: d.processo?.empreendimento?.nome ?? null, relacionado: !!d.processo?.empreendimento && rel.has(d.processo.empreendimento.id) }))
    .sort((a, b) => Number(b.relacionado) - Number(a.relacionado));
}

async function alertaParaTratar(u: UsuarioSessao, id: string) {
  const a = await prisma.alertaDesmatamento.findUnique({ where: { id } });
  if (!a) throw naoEncontrado("Alerta não encontrado.");
  if (!podeVerMunicipio(u, a.municipio_id)) throw proibido();
  if (!podeTratarAlerta(u, a.municipio_id)) throw proibido("Seu perfil não pode tratar alertas do monitoramento.");
  return a;
}

const resumo = (a: { status: string; observacao: string | null; documento_id: string | null; fiscalizacao_id: string | null }) => ({ status: a.status, observacao: a.observacao, documento_id: a.documento_id, fiscalizacao_id: a.fiscalizacao_id });

/**
 * Altera a situação: AUTORIZADO exige licença/ASV válida do mesmo município; DESCARTADO e IRREGULAR exigem justificativa.
 */
export async function alterarStatusAlerta(u: UsuarioSessao, id: string, d: { status: StatusAlertaDesmatamento; observacao?: string | null; documento_id?: string | null }) {
  const a = await alertaParaTratar(u, id);
  if (a.status === d.status) throw invalido("O alerta já está nesta situação.");
  if (!podeTransicionarAlerta(a.status, d.status)) throw invalido(`Não é possível passar de "${ROTULO_STATUS_ALERTA[a.status]}" para "${ROTULO_STATUS_ALERTA[d.status]}".`);
  const obs = (d.observacao ?? "").trim();
  let documentoId: string | null = a.documento_id;
  if (d.status === "AUTORIZADO") {
    if (!d.documento_id) throw invalido("Selecione a licença/ASV que autoriza a supressão.");
    const doc = await prisma.documentoOficial.findUnique({ where: { id: d.documento_id }, select: { id: true, municipio_id: true, status: true, tipo: true } });
    if (!doc || doc.municipio_id !== a.municipio_id || doc.status !== "VALIDO" || !["LICENCA", "AUTORIZACAO"].includes(doc.tipo)) throw invalido("Licença/autorização inválida para este alerta.");
    documentoId = doc.id;
  } else if (d.status === "DESCARTADO" || d.status === "IRREGULAR") {
    if (obs.length < 5) throw invalido(d.status === "DESCARTADO" ? "Informe o motivo do descarte (mín. 5 caracteres)." : "Descreva a constatação (mín. 5 caracteres).");
  }
  if (d.status !== "AUTORIZADO" && d.status !== "EM_ANALISE") documentoId = null;
  return prisma.$transaction(async (tx) => {
    const depois = await tx.alertaDesmatamento.update({
      where: { id: a.id },
      data: { status: d.status, observacao: obs ? obs.slice(0, 3000) : a.observacao, documento_id: documentoId, atualizado_por: u.id },
    });
    await auditar({ usuario_id: u.id, acao: "MONITORAMENTO_ALTERAR_STATUS", entidade: "alerta_desmatamento", entidade_id: a.id, antes: resumo(a), depois: resumo(depois) }, tx);
    return depois;
  });
}

/**
 * "Abrir fiscalização": cria a vistoria AGENDADA (origem ROTINA) no centroide do alerta, vinculada a ele e ao empreendimento
 * relacionado pelo CAR (se houver); o alerta NOVO passa a EM_ANÁLISE. Idempotente: se já houver fiscalização, devolve-a.
 */
export async function abrirFiscalizacao(u: UsuarioSessao, id: string): Promise<{ fiscalizacao_id: string; criada: boolean }> {
  const a = await alertaParaTratar(u, id);
  if (a.fiscalizacao_id) return { fiscalizacao_id: a.fiscalizacao_id, criada: false };
  const cruz = (a.cruzamento ?? null) as Cruzamento | null;
  const emp = cruz?.empreendimentos?.find((e) => e.via === "CAR") ?? cruz?.empreendimentos?.[0] ?? null;
  const empOk = emp ? await prisma.empreendimento.findFirst({ where: { id: emp.id, municipio_id: a.municipio_id }, select: { id: true } }) : null;
  const imoveis = cruz?.car?.imoveis ?? [];
  const relato = [
    `Vistoria para apuração de alerta de desmatamento por satélite – ${ROTULO_FONTE[a.fonte]} ${a.id_externo}, detectado em ${a.data_deteccao.toISOString().slice(0, 10).split("-").reverse().join("/")}, ${Number(a.area_ha).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha (classe ${a.classe}).`,
    imoveis.length ? `Imóvel(is) do CAR: ${imoveis.map((i) => `${i.cod_imovel} (${i.sobreposicao_ha.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha sobrepostos)`).join("; ")}.` : "Área fora de imóveis do CAR.",
    cruz?.motivo ? `Cruzamento: ${cruz.motivo}` : null,
  ].filter(Boolean).join("\n");
  return prisma.$transaction(async (tx) => {
    const f = await tx.fiscalizacao.create({
      data: {
        organizacao_id: a.organizacao_id, municipio_id: a.municipio_id, origem: "ROTINA", empreendimento_id: empOk?.id ?? null,
        data_hora: new Date(), latitude: a.latitude, longitude: a.longitude, equipe: [{ usuario_id: u.id, nome: u.nome }],
        relato, status: "AGENDADA", created_by: u.id,
      },
    });
    await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "fiscalizacao", entidade_id: f.id, depois: { ...f, alerta_desmatamento_id: a.id } }, tx);
    const depois = await tx.alertaDesmatamento.update({ where: { id: a.id }, data: { fiscalizacao_id: f.id, status: a.status === "NOVO" ? "EM_ANALISE" : a.status, atualizado_por: u.id } });
    await auditar({ usuario_id: u.id, acao: "MONITORAMENTO_ABRIR_FISCALIZACAO", entidade: "alerta_desmatamento", entidade_id: a.id, antes: resumo(a), depois: resumo(depois) }, tx);
    return { fiscalizacao_id: f.id, criada: true };
  });
}

/** Última sincronização (e se há uma em andamento) por município do escopo. */
export async function ultimasSincronizacoes(u: UsuarioSessao, municipioId?: string | null) {
  return prisma.monitoramentoSync.findMany({
    where: whereMunicipio(u, municipioId), orderBy: { iniciado_em: "desc" }, take: 5,
    select: { id: true, status: true, origem: true, iniciado_em: true, concluido_em: true, resumo: true, erro: true, municipio: { select: { nome: true, sigla: true } } },
  });
}
