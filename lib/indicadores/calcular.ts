import "server-only";
import { Prisma, type StatusProcesso } from "@prisma/client";
import { prisma } from "@/lib/db";
import { inicioDoDia } from "@/lib/dias";
import { whereMunicipio, type UsuarioSessao } from "@/lib/rbac";
import {
  DIAS_LICENCA_VENCENDO,
  DIAS_VENCENDO,
  META_ADESAO,
  ORDEM_STATUS,
  STATUS_EM_ANDAMENTO,
  aderiu,
  dataFiltro,
  mediaDias,
  periodoPadrao,
  resumoAdesao,
} from "./agregacao";

// Fonte única dos indicadores (SPEC 11): dashboard, API /indicadores e relatórios usam esta função.

export type FiltrosIndicadores = {
  municipio_id?: string | null;
  de?: string | null; // aaaa-mm-dd
  ate?: string | null; // aaaa-mm-dd
  tipo_ato_id?: string | null;
  tecnico_id?: string | null;
};

/** Status com relógio correndo – mesmo critério da tela Prazos (lib/alertas/regras.ts STATUS_COM_PRAZO). */
const STATUS_COM_PRAZO: StatusProcesso[] = ["PROTOCOLADO", "EM_TRIAGEM", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO"];
const TIPOS_LICENCA = ["LICENCA", "AUTORIZACAO", "CERTIDAO"] as const;
const DIA = 86400000;

export type LinhaMunicipio = {
  municipio_id: string;
  nome: string;
  sigla: string;
  protocolados: number;
  em_andamento: number;
  concluidos: number;
  tempo_medio_dias: number | null;
  prazo_vencido: number;
  prazo_vencendo: number;
  licencas_emitidas: number;
  licencas_vencendo_90: number;
  denuncias_recebidas: number;
  denuncias_apuradas: number;
  fiscalizacoes: number;
  autos: number;
  multas_total: number;
  notificacoes: number;
  usuarios_ativos: number;
  processos_total: number;
  aderiu: boolean;
};

export type Indicadores = Awaited<ReturnType<typeof calcularIndicadores>>;

/** Resolve filtros + escopo (municípios visíveis) – reutilizado pelos relatórios. */
export async function resolverEscopo(usuario: UsuarioSessao, filtros: FiltrosIndicadores) {
  const padrao = periodoPadrao();
  const deStr = dataFiltro(filtros.de) ? filtros.de! : padrao.de;
  const ateStr = dataFiltro(filtros.ate) ? filtros.ate! : padrao.ate;
  const de = dataFiltro(deStr)!;
  const ate = dataFiltro(ateStr, true)!;

  const wm = whereMunicipio(usuario, filtros.municipio_id || null);
  const municipios = await prisma.municipio.findMany({
    where: wm.municipio_id === undefined ? {} : { id: wm.municipio_id },
    select: { id: true, nome: true, sigla: true, organizacao_id: true },
    orderBy: { nome: "asc" },
  });
  const ids = municipios.map((m) => m.id);

  const [tipoAto, tecnico] = await Promise.all([
    filtros.tipo_ato_id ? prisma.tipoAto.findUnique({ where: { id: filtros.tipo_ato_id }, select: { id: true, sigla: true, nome: true } }).catch(() => null) : null,
    filtros.tecnico_id ? prisma.usuario.findUnique({ where: { id: filtros.tecnico_id }, select: { id: true, nome: true } }).catch(() => null) : null,
  ]);
  const municipioSel = filtros.municipio_id ? municipios.find((m) => m.id === filtros.municipio_id) ?? null : null;

  return {
    ids,
    municipios,
    de,
    ate,
    deStr,
    ateStr,
    tipoAto,
    tecnico,
    municipio: municipioSel,
    /** Descrição legível dos filtros (cabeçalho de relatórios). */
    descricao: {
      municipio: municipioSel ? municipioSel.nome : filtros.municipio_id ? "(sem acesso)" : "Todos os municípios",
      periodo: [deStr, ateStr] as const,
      tipo_ato: tipoAto ? `${tipoAto.sigla} – ${tipoAto.nome}` : "Todos",
      tecnico: tecnico ? tecnico.nome : "Todos",
    },
  };
}

export type Escopo = Awaited<ReturnType<typeof resolverEscopo>>;

/** Fragmento SQL de filtros de processo (alias `p`): escopo + tipo de ato + técnico. */
export function sqlFiltroProcesso(e: Escopo, opts: { ignorarTecnico?: boolean } = {}) {
  const partes = [Prisma.sql`p.municipio_id = ANY(${e.ids}::uuid[])`, Prisma.sql`p.status <> 'RASCUNHO'`];
  if (e.tipoAto) partes.push(Prisma.sql`p.tipo_ato_id = ${e.tipoAto.id}::uuid`);
  if (e.tecnico && !opts.ignorarTecnico) partes.push(Prisma.sql`p.tecnico_id = ${e.tecnico.id}::uuid`);
  return Prisma.join(partes, " AND ");
}

const n = (v: unknown) => Number(v ?? 0);

export async function calcularIndicadores(usuario: UsuarioSessao, filtros: FiltrosIndicadores = {}) {
  const e = await resolverEscopo(usuario, filtros);
  const agora = new Date();
  const hoje0 = inicioDoDia(agora);
  const limiteVencendo = new Date(hoje0.getTime() + (DIAS_VENCENDO + 1) * DIA);
  const limiteLicenca = new Date(agora.getTime() + DIAS_LICENCA_VENCENDO * DIA);
  const fp = sqlFiltroProcesso(e);
  const ids = e.ids;
  const emAndamento = STATUS_EM_ANDAMENTO as string[];
  const comPrazo = STATUS_COM_PRAZO as string[];
  const tiposLic = [...TIPOS_LICENCA] as string[];
  // Filtros de processo aplicados a documentos (via processo vinculado)
  const fDocProc = e.tipoAto || e.tecnico
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM processo p WHERE p.id = d.processo_id AND ${fp})`
    : Prisma.empty;

  const [protocoladosRows, snapshotRows, concluidosRows, licencasRows, licVencRows, denRows, fiscRows, autoRows, notRows, usuRows, procTotalRows] =
    await Promise.all([
      // Protocolados no período por município × status × tipo de ato
      prisma.$queryRaw<{ municipio_id: string; status: StatusProcesso; tipo_ato_id: string; total: bigint }[]>`
        SELECT p.municipio_id, p.status, p.tipo_ato_id, COUNT(*) AS total
        FROM processo p
        WHERE ${fp} AND p.data_protocolo BETWEEN ${e.de} AND ${e.ate}
        GROUP BY 1, 2, 3`,
      // Situação atual (fotografia): em andamento, prazo vencido/vencendo
      prisma.$queryRaw<{ municipio_id: string; em_andamento: bigint; vencido: bigint; vencendo: bigint }[]>`
        SELECT p.municipio_id,
          COUNT(*) FILTER (WHERE p.status::text = ANY(${emAndamento}) AND p.data_protocolo <= ${e.ate}) AS em_andamento,
          COUNT(*) FILTER (WHERE p.status::text = ANY(${comPrazo}) AND NOT p.prazo_pausado AND p.prazo_etapa_ate < ${hoje0}) AS vencido,
          COUNT(*) FILTER (WHERE p.status::text = ANY(${comPrazo}) AND NOT p.prazo_pausado AND p.prazo_etapa_ate >= ${hoje0} AND p.prazo_etapa_ate < ${limiteVencendo}) AS vencendo
        FROM processo p
        WHERE ${fp}
        GROUP BY 1`,
      // Concluídos no período (protocolo → conclusão) por município × tipo de ato
      prisma.$queryRaw<{ municipio_id: string; tipo_ato_id: string; total: bigint; soma_dias: number | null; com_tempo: bigint }[]>`
        SELECT p.municipio_id, p.tipo_ato_id, COUNT(*) AS total,
          SUM(EXTRACT(EPOCH FROM (COALESCE(p.data_conclusao, p.updated_at) - p.data_protocolo)) / 86400.0)::float8 AS soma_dias,
          COUNT(p.data_protocolo) AS com_tempo
        FROM processo p
        WHERE ${fp} AND p.status = 'CONCLUIDO' AND COALESCE(p.data_conclusao, p.updated_at) BETWEEN ${e.de} AND ${e.ate}
        GROUP BY 1, 2`,
      // Licenças/autorizações/certidões válidas emitidas no período
      prisma.$queryRaw<{ municipio_id: string; sigla: string; total: bigint }[]>`
        SELECT d.municipio_id, COALESCE(d.sigla_ato, d.tipo::text) AS sigla, COUNT(*) AS total
        FROM documento_oficial d
        WHERE d.municipio_id = ANY(${ids}::uuid[]) AND d.tipo::text = ANY(${tiposLic}) AND d.status = 'VALIDO'
          AND d.emitido_em BETWEEN ${e.de} AND ${e.ate} ${fDocProc}
        GROUP BY 1, 2`,
      prisma.$queryRaw<{ municipio_id: string; total: bigint }[]>`
        SELECT d.municipio_id, COUNT(*) AS total
        FROM documento_oficial d
        WHERE d.municipio_id = ANY(${ids}::uuid[]) AND d.tipo::text = ANY(${tiposLic}) AND d.status = 'VALIDO'
          AND d.validade_ate BETWEEN ${agora} AND ${limiteLicenca} ${fDocProc}
        GROUP BY 1`,
      prisma.$queryRaw<{ municipio_id: string; recebidas: bigint; apuradas: bigint }[]>`
        SELECT municipio_id, COUNT(*) AS recebidas, COUNT(*) FILTER (WHERE status = 'CONCLUIDA') AS apuradas
        FROM denuncia
        WHERE municipio_id = ANY(${ids}::uuid[]) AND created_at BETWEEN ${e.de} AND ${e.ate}
        GROUP BY 1`,
      prisma.$queryRaw<{ municipio_id: string; total: bigint }[]>`
        SELECT municipio_id, COUNT(*) AS total
        FROM fiscalizacao
        WHERE municipio_id = ANY(${ids}::uuid[]) AND status = 'REALIZADA' AND data_hora BETWEEN ${e.de} AND ${e.ate}
        GROUP BY 1`,
      prisma.$queryRaw<{ municipio_id: string; total: bigint; multas: string | null }[]>`
        SELECT municipio_id, COUNT(*) AS total, COALESCE(SUM(valor_multa), 0)::text AS multas
        FROM auto_infracao
        WHERE municipio_id = ANY(${ids}::uuid[]) AND status <> 'CANCELADO' AND created_at BETWEEN ${e.de} AND ${e.ate}
        GROUP BY 1`,
      prisma.$queryRaw<{ municipio_id: string; total: bigint }[]>`
        SELECT municipio_id, COUNT(*) AS total
        FROM notificacao
        WHERE municipio_id = ANY(${ids}::uuid[]) AND status <> 'CANCELADA' AND created_at BETWEEN ${e.de} AND ${e.ate}
        GROUP BY 1`,
      // Adesão: usuários ativos com vínculo municipal (papéis internos)
      prisma.$queryRaw<{ municipio_id: string; total: bigint }[]>`
        SELECT up.municipio_id, COUNT(DISTINCT u.id) AS total
        FROM usuario_papel up JOIN usuario u ON u.id = up.usuario_id
        WHERE up.municipio_id = ANY(${ids}::uuid[]) AND u.ativo AND up.papel <> 'REQUERENTE'
        GROUP BY 1`,
      prisma.$queryRaw<{ municipio_id: string; total: bigint }[]>`
        SELECT p.municipio_id, COUNT(*) AS total
        FROM processo p
        WHERE p.municipio_id = ANY(${ids}::uuid[]) AND p.status <> 'RASCUNHO' AND p.data_protocolo IS NOT NULL AND p.data_protocolo <= ${e.ate}
        GROUP BY 1`,
    ]);

  const tiposIds = [...new Set([...protocoladosRows.map((r) => r.tipo_ato_id), ...concluidosRows.map((r) => r.tipo_ato_id)])];
  const tipos = await prisma.tipoAto.findMany({ where: { id: { in: tiposIds } }, select: { id: true, sigla: true, nome: true } });
  const tipoPorId = new Map(tipos.map((t) => [t.id, t]));

  const porMun = <T extends { municipio_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.municipio_id, [...(m.get(r.municipio_id) ?? []), r]);
    return m;
  };
  const um = <T extends { municipio_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.municipio_id, r]));
  const protM = porMun(protocoladosRows);
  const concM = porMun(concluidosRows);
  const licM = porMun(licencasRows);
  const snapM = um(snapshotRows);
  const licVM = um(licVencRows);
  const denM = um(denRows);
  const fiscM = um(fiscRows);
  const autoM = um(autoRows);
  const notM = um(notRows);
  const usuM = um(usuRows);
  const procTM = um(procTotalRows);

  const municipios: LinhaMunicipio[] = e.municipios.map((m) => {
    const conc = concM.get(m.id) ?? [];
    const somaDias = conc.reduce((s, r) => s + n(r.soma_dias), 0);
    const comTempo = conc.reduce((s, r) => s + n(r.com_tempo), 0);
    const linha = {
      municipio_id: m.id,
      nome: m.nome,
      sigla: m.sigla,
      protocolados: (protM.get(m.id) ?? []).reduce((s, r) => s + n(r.total), 0),
      em_andamento: n(snapM.get(m.id)?.em_andamento),
      concluidos: conc.reduce((s, r) => s + n(r.total), 0),
      tempo_medio_dias: mediaDias(somaDias, comTempo),
      prazo_vencido: n(snapM.get(m.id)?.vencido),
      prazo_vencendo: n(snapM.get(m.id)?.vencendo),
      licencas_emitidas: (licM.get(m.id) ?? []).reduce((s, r) => s + n(r.total), 0),
      licencas_vencendo_90: n(licVM.get(m.id)?.total),
      denuncias_recebidas: n(denM.get(m.id)?.recebidas),
      denuncias_apuradas: n(denM.get(m.id)?.apuradas),
      fiscalizacoes: n(fiscM.get(m.id)?.total),
      autos: n(autoM.get(m.id)?.total),
      multas_total: Number(autoM.get(m.id)?.multas ?? 0),
      notificacoes: n(notM.get(m.id)?.total),
      usuarios_ativos: n(usuM.get(m.id)?.total),
      processos_total: n(procTM.get(m.id)?.total),
      aderiu: false,
    };
    linha.aderiu = aderiu(linha);
    return linha;
  });

  // Totais (tempo médio ponderado pelo nº de concluídos com data)
  const somaDiasTotal = concluidosRows.reduce((s, r) => s + n(r.soma_dias), 0);
  const comTempoTotal = concluidosRows.reduce((s, r) => s + n(r.com_tempo), 0);
  const soma = (k: keyof LinhaMunicipio) => municipios.reduce((s, l) => s + Number(l[k] ?? 0), 0);
  const totais = {
    protocolados: soma("protocolados"),
    em_andamento: soma("em_andamento"),
    concluidos: soma("concluidos"),
    tempo_medio_dias: mediaDias(somaDiasTotal, comTempoTotal),
    prazo_vencido: soma("prazo_vencido"),
    prazo_vencendo: soma("prazo_vencendo"),
    licencas_emitidas: soma("licencas_emitidas"),
    licencas_vencendo_90: soma("licencas_vencendo_90"),
    denuncias_recebidas: soma("denuncias_recebidas"),
    denuncias_apuradas: soma("denuncias_apuradas"),
    fiscalizacoes: soma("fiscalizacoes"),
    autos: soma("autos"),
    multas_total: Math.round(soma("multas_total") * 100) / 100,
    notificacoes: soma("notificacoes"),
    usuarios_ativos: soma("usuarios_ativos"),
    processos_total: soma("processos_total"),
  };

  // Por status (processos protocolados no período, status atual)
  const statusMap = new Map<string, number>();
  for (const r of protocoladosRows) statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + n(r.total));
  const porStatus = ORDEM_STATUS.map((s) => ({ status: s, total: statusMap.get(s) ?? 0 }));

  // Por tipo de ato
  const tipoMap = new Map<string, number>();
  for (const r of protocoladosRows) tipoMap.set(r.tipo_ato_id, (tipoMap.get(r.tipo_ato_id) ?? 0) + n(r.total));
  const porTipoAto = [...tipoMap.entries()]
    .map(([id, total]) => ({ tipo_ato_id: id, sigla: tipoPorId.get(id)?.sigla ?? "?", nome: tipoPorId.get(id)?.nome ?? "?", total }))
    .sort((a, b) => b.total - a.total || a.sigla.localeCompare(b.sigla));

  // Tempo médio por tipo de ato
  const tm = new Map<string, { soma: number; n: number; concluidos: number }>();
  for (const r of concluidosRows) {
    const a = tm.get(r.tipo_ato_id) ?? { soma: 0, n: 0, concluidos: 0 };
    a.soma += n(r.soma_dias);
    a.n += n(r.com_tempo);
    a.concluidos += n(r.total);
    tm.set(r.tipo_ato_id, a);
  }
  const tempoMedioPorTipo = [...tm.entries()]
    .map(([id, a]) => ({ tipo_ato_id: id, sigla: tipoPorId.get(id)?.sigla ?? "?", nome: tipoPorId.get(id)?.nome ?? "?", dias: mediaDias(a.soma, a.n), concluidos: a.concluidos }))
    .sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0));

  // Licenças por tipo e por tipo × município
  const licTipo = new Map<string, number>();
  for (const r of licencasRows) licTipo.set(r.sigla, (licTipo.get(r.sigla) ?? 0) + n(r.total));
  const licencasPorTipo = [...licTipo.entries()].map(([sigla, total]) => ({ sigla, total })).sort((a, b) => b.total - a.total);
  const nomeMun = new Map(e.municipios.map((m) => [m.id, m.nome]));
  const licencasPorTipoMunicipio = licencasRows.map((r) => ({ municipio_id: r.municipio_id, municipio: nomeMun.get(r.municipio_id) ?? "?", sigla: r.sigla, total: n(r.total) }));

  const adesao = { ...resumoAdesao(municipios, META_ADESAO), municipios: municipios.map((m) => ({ municipio_id: m.municipio_id, nome: m.nome, usuarios_ativos: m.usuarios_ativos, processos_total: m.processos_total, aderiu: m.aderiu })) };

  return {
    gerado_em: agora.toISOString(),
    filtros: {
      municipio_id: e.municipio?.id ?? null,
      de: e.deStr,
      ate: e.ateStr,
      tipo_ato_id: e.tipoAto?.id ?? null,
      tecnico_id: e.tecnico?.id ?? null,
      descricao: e.descricao,
    },
    definicoes: { dias_vencendo: DIAS_VENCENDO, dias_licenca_vencendo: DIAS_LICENCA_VENCENDO, meta_adesao: META_ADESAO },
    totais,
    porStatus,
    porTipoAto,
    tempoMedioPorTipo,
    licencasPorTipo,
    licencasPorTipoMunicipio,
    municipios,
    adesao,
  };
}

/** Opções dos filtros (municípios no escopo, tipos de ato, técnicos). */
export async function opcoesFiltros(usuario: UsuarioSessao) {
  const wm = whereMunicipio(usuario);
  const municipios = await prisma.municipio.findMany({ where: wm.municipio_id === undefined ? {} : { id: wm.municipio_id }, select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  const ids = municipios.map((m) => m.id);
  const [tiposAto, tecnicos] = await Promise.all([
    prisma.tipoAto.findMany({ where: { ativo: true }, select: { id: true, sigla: true, nome: true }, orderBy: { sigla: "asc" } }),
    prisma.usuario.findMany({
      where: {
        papeis: { some: { papel: { in: ["TEC_CONSORCIO", "TEC_MUNICIPAL"] }, OR: [{ municipio_id: null }, { municipio_id: { in: ids } }] } },
      },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);
  return { municipios, tiposAto, tecnicos };
}
