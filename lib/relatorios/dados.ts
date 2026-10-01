import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fmtData, fmtMoeda, fmtNumero } from "@/lib/format";
import type { UsuarioSessao } from "@/lib/rbac";
import { ROTULO_STATUS } from "@/components/ui";
import { calcularIndicadores, resolverEscopo, sqlFiltroProcesso, type Escopo, type FiltrosIndicadores } from "@/lib/indicadores/calcular";
import { DIAS_LICENCA_VENCENDO, DIAS_VENCENDO, tempoMedio } from "@/lib/indicadores/agregacao";
import { inicioDoDia } from "@/lib/dias";
import { TIPOS_RELATORIO, type Relatorio, type TipoRelatorio } from "./modelo";

// Dados de cada relatório (SPEC 11). Mesmo escopo/filtros de calcularIndicadores() → números idênticos ao painel.

const DIA = 86400000;
const LIMITE_LINHAS = 20000;

function filtrosLegiveis(e: Escopo): [string, string][] {
  return [
    ["Município", e.descricao.municipio],
    ["Período", `${fmtData(e.de)} a ${fmtData(e.ate)}`],
    ["Tipo de ato", e.descricao.tipo_ato],
    ["Técnico", e.descricao.tecnico],
  ];
}

function whereProcessos(e: Escopo): Prisma.ProcessoWhereInput {
  return {
    municipio_id: { in: e.ids },
    status: { not: "RASCUNHO" },
    ...(e.tipoAto ? { tipo_ato_id: e.tipoAto.id } : {}),
    ...(e.tecnico ? { tecnico_id: e.tecnico.id } : {}),
  };
}

const titulo = (t: TipoRelatorio) => TIPOS_RELATORIO.find((r) => r.tipo === t)!.titulo;

async function relProcessos(e: Escopo): Promise<Relatorio> {
  const processos = await prisma.processo.findMany({
    where: { ...whereProcessos(e), data_protocolo: { gte: e.de, lte: e.ate } },
    select: {
      numero: true, status: true, data_protocolo: true, data_conclusao: true, prazo_etapa_ate: true,
      municipio: { select: { nome: true } }, tipo_ato: { select: { sigla: true } }, requerente: { select: { nome: true } },
      empreendimento: { select: { nome: true } }, tecnico: { select: { nome: true } },
    },
    orderBy: [{ data_protocolo: "asc" }],
    take: LIMITE_LINHAS,
  });
  const porStatus = new Map<string, number>();
  const porTipo = new Map<string, number>();
  for (const p of processos) {
    porStatus.set(p.status, (porStatus.get(p.status) ?? 0) + 1);
    porTipo.set(p.tipo_ato.sigla, (porTipo.get(p.tipo_ato.sigla) ?? 0) + 1);
  }
  return {
    tipo: "processos",
    titulo: titulo("processos"),
    paisagem: true,
    filtros: filtrosLegiveis(e),
    resumo: [["Processos protocolados no período", fmtNumero(processos.length)]],
    secoes: [
      {
        titulo: "Resumo por status",
        colunas: [{ chave: "status", titulo: "Status", largura: 28 }, { chave: "total", titulo: "Processos", tipo: "inteiro", largura: 12 }],
        linhas: [...porStatus.entries()].map(([s, total]) => ({ status: ROTULO_STATUS[s as keyof typeof ROTULO_STATUS] ?? s, total })),
        total: { status: "Total", total: processos.length },
      },
      {
        titulo: "Resumo por tipo de ato",
        colunas: [{ chave: "sigla", titulo: "Tipo de ato", largura: 16 }, { chave: "total", titulo: "Processos", tipo: "inteiro", largura: 12 }],
        linhas: [...porTipo.entries()].sort((a, b) => b[1] - a[1]).map(([sigla, total]) => ({ sigla, total })),
        total: { sigla: "Total", total: processos.length },
      },
      {
        titulo: "Processos",
        colunas: [
          { chave: "numero", titulo: "Nº do processo", largura: 20 },
          { chave: "municipio", titulo: "Município", largura: 16 },
          { chave: "tipo", titulo: "Tipo", largura: 8 },
          { chave: "requerente", titulo: "Requerente", largura: 32 },
          { chave: "empreendimento", titulo: "Empreendimento", largura: 32 },
          { chave: "status", titulo: "Status", largura: 20 },
          { chave: "tecnico", titulo: "Técnico", largura: 24 },
          { chave: "protocolo", titulo: "Protocolo", tipo: "data", largura: 12 },
          { chave: "conclusao", titulo: "Conclusão", tipo: "data", largura: 12 },
          { chave: "prazo", titulo: "Prazo da etapa", tipo: "data", largura: 14 },
        ],
        linhas: processos.map((p) => ({
          numero: p.numero, municipio: p.municipio.nome, tipo: p.tipo_ato.sigla, requerente: p.requerente.nome, empreendimento: p.empreendimento.nome,
          status: ROTULO_STATUS[p.status], tecnico: p.tecnico?.nome ?? "—", protocolo: p.data_protocolo, conclusao: p.data_conclusao, prazo: p.prazo_etapa_ate,
        })),
      },
    ],
  };
}

async function relLicencas(e: Escopo): Promise<Relatorio> {
  const agora = new Date();
  const wDoc: Prisma.DocumentoOficialWhereInput = {
    municipio_id: { in: e.ids },
    tipo: { in: ["LICENCA", "AUTORIZACAO", "CERTIDAO"] },
    status: "VALIDO",
    ...(e.tipoAto || e.tecnico ? { processo: { ...(e.tipoAto ? { tipo_ato_id: e.tipoAto.id } : {}), ...(e.tecnico ? { tecnico_id: e.tecnico.id } : {}) } } : {}),
  };
  const sel = {
    numero: true, sigla_ato: true, tipo: true, emitido_em: true, validade_ate: true, emitido_por_nome: true,
    municipio: { select: { nome: true } },
    processo: { select: { numero: true, requerente: { select: { nome: true } }, empreendimento: { select: { nome: true } } } },
  } satisfies Prisma.DocumentoOficialSelect;
  const [emitidas, vencendo] = await Promise.all([
    prisma.documentoOficial.findMany({ where: { ...wDoc, emitido_em: { gte: e.de, lte: e.ate } }, select: sel, orderBy: { emitido_em: "asc" }, take: LIMITE_LINHAS }),
    prisma.documentoOficial.findMany({ where: { ...wDoc, validade_ate: { gte: agora, lte: new Date(agora.getTime() + DIAS_LICENCA_VENCENDO * DIA) } }, select: sel, orderBy: { validade_ate: "asc" }, take: LIMITE_LINHAS }),
  ]);
  const colunas = [
    { chave: "numero", titulo: "Número", largura: 22 },
    { chave: "tipo", titulo: "Tipo", largura: 10 },
    { chave: "municipio", titulo: "Município", largura: 16 },
    { chave: "processo", titulo: "Processo", largura: 20 },
    { chave: "titular", titulo: "Titular", largura: 32 },
    { chave: "empreendimento", titulo: "Empreendimento", largura: 30 },
    { chave: "emissao", titulo: "Emissão", tipo: "data" as const, largura: 12 },
    { chave: "validade", titulo: "Validade", tipo: "data" as const, largura: 12 },
    { chave: "dias", titulo: "Dias p/ vencer", tipo: "inteiro" as const, largura: 12 },
  ];
  const linha = (d: (typeof emitidas)[number]) => ({
    numero: d.numero, tipo: d.sigla_ato ?? d.tipo, municipio: d.municipio.nome, processo: d.processo?.numero ?? "—",
    titular: d.processo?.requerente.nome ?? "—", empreendimento: d.processo?.empreendimento.nome ?? "—",
    emissao: d.emitido_em, validade: d.validade_ate,
    dias: d.validade_ate ? Math.round((inicioDoDia(d.validade_ate).getTime() - inicioDoDia(agora).getTime()) / DIA) : null,
  });
  const porTipo = new Map<string, number>();
  for (const d of emitidas) porTipo.set(d.sigla_ato ?? d.tipo, (porTipo.get(d.sigla_ato ?? d.tipo) ?? 0) + 1);
  return {
    tipo: "licencas",
    titulo: titulo("licencas"),
    paisagem: true,
    filtros: filtrosLegiveis(e),
    resumo: [["Emitidas no período (válidas)", fmtNumero(emitidas.length)], [`Vencendo em ${DIAS_LICENCA_VENCENDO} dias`, fmtNumero(vencendo.length)]],
    secoes: [
      {
        titulo: "Emitidas por tipo",
        colunas: [{ chave: "sigla", titulo: "Tipo", largura: 16 }, { chave: "total", titulo: "Emitidas", tipo: "inteiro", largura: 12 }],
        linhas: [...porTipo.entries()].sort((a, b) => b[1] - a[1]).map(([sigla, total]) => ({ sigla, total })),
        total: { sigla: "Total", total: emitidas.length },
      },
      { titulo: "Licenças emitidas no período", colunas, linhas: emitidas.map(linha) },
      { titulo: `Licenças vencendo nos próximos ${DIAS_LICENCA_VENCENDO} dias`, colunas, linhas: vencendo.map(linha), nota: "Situação atual (independe do período)." },
    ],
  };
}

async function relFiscalizacao(e: Escopo): Promise<Relatorio> {
  const wm = { municipio_id: { in: e.ids } };
  const per = { gte: e.de, lte: e.ate };
  const [denuncias, fiscalizacoes, autos, notificacoes] = await Promise.all([
    prisma.denuncia.findMany({ where: { ...wm, created_at: per }, select: { protocolo: true, canal: true, status: true, created_at: true, endereco: true, municipio: { select: { nome: true } } }, orderBy: { created_at: "asc" }, take: LIMITE_LINHAS }),
    prisma.fiscalizacao.findMany({ where: { ...wm, status: "REALIZADA", data_hora: per }, select: { data_hora: true, origem: true, constatacao: true, latitude: true, longitude: true, municipio: { select: { nome: true } }, denuncia: { select: { protocolo: true } }, empreendimento: { select: { nome: true } } }, orderBy: { data_hora: "asc" }, take: LIMITE_LINHAS }),
    prisma.autoInfracao.findMany({ where: { ...wm, status: { not: "CANCELADO" }, created_at: per }, select: { numero: true, penalidade: true, valor_multa: true, status: true, created_at: true, autuado: { select: { nome: true } }, fiscalizacao: { select: { municipio: { select: { nome: true } } } } }, orderBy: { created_at: "asc" }, take: LIMITE_LINHAS }),
    prisma.notificacao.findMany({ where: { ...wm, status: { not: "CANCELADA" }, created_at: per }, select: { numero: true, status: true, created_at: true, prazo_ate: true, exigencia: true, notificado: { select: { nome: true } } }, orderBy: { created_at: "asc" }, take: LIMITE_LINHAS }),
  ]);
  const totalMultas = autos.reduce((s, a) => s + Number(a.valor_multa ?? 0), 0);
  const apuradas = denuncias.filter((d) => d.status === "CONCLUIDA").length;
  return {
    tipo: "fiscalizacao",
    titulo: titulo("fiscalizacao"),
    paisagem: true,
    filtros: filtrosLegiveis(e).filter(([k]) => k !== "Tipo de ato" && k !== "Técnico"),
    resumo: [
      ["Denúncias recebidas", fmtNumero(denuncias.length)],
      ["Denúncias apuradas", fmtNumero(apuradas)],
      ["Fiscalizações/vistorias", fmtNumero(fiscalizacoes.length)],
      ["Autos de infração", fmtNumero(autos.length)],
      ["Total de multas", fmtMoeda(totalMultas)],
      ["Notificações", fmtNumero(notificacoes.length)],
    ],
    secoes: [
      {
        titulo: "Denúncias",
        colunas: [
          { chave: "protocolo", titulo: "Protocolo", largura: 20 }, { chave: "municipio", titulo: "Município", largura: 16 }, { chave: "canal", titulo: "Canal", largura: 12 },
          { chave: "data", titulo: "Recebida em", tipo: "data", largura: 12 }, { chave: "status", titulo: "Status", largura: 14 }, { chave: "endereco", titulo: "Local", largura: 36 },
        ],
        linhas: denuncias.map((d) => ({ protocolo: d.protocolo, municipio: d.municipio.nome, canal: d.canal, data: d.created_at, status: d.status, endereco: d.endereco ?? "—" })),
      },
      {
        titulo: "Fiscalizações / vistorias",
        colunas: [
          { chave: "data", titulo: "Data", tipo: "datahora", largura: 16 }, { chave: "municipio", titulo: "Município", largura: 16 }, { chave: "origem", titulo: "Origem", largura: 12 },
          { chave: "ref", titulo: "Denúncia / empreendimento", largura: 32 }, { chave: "constatacao", titulo: "Constatação", largura: 14 },
          { chave: "lat", titulo: "Latitude", tipo: "decimal", largura: 12 }, { chave: "lng", titulo: "Longitude", tipo: "decimal", largura: 12 },
        ],
        linhas: fiscalizacoes.map((f) => ({ data: f.data_hora, municipio: f.municipio.nome, origem: f.origem, ref: f.denuncia?.protocolo ?? f.empreendimento?.nome ?? "—", constatacao: f.constatacao ?? "—", lat: f.latitude ? Number(f.latitude) : null, lng: f.longitude ? Number(f.longitude) : null })),
      },
      {
        titulo: "Autos de infração",
        colunas: [
          { chave: "numero", titulo: "Número", largura: 20 }, { chave: "municipio", titulo: "Município", largura: 16 }, { chave: "data", titulo: "Lavrado em", tipo: "data", largura: 12 },
          { chave: "autuado", titulo: "Autuado", largura: 32 }, { chave: "penalidade", titulo: "Penalidade", largura: 14 }, { chave: "status", titulo: "Status", largura: 12 },
          { chave: "valor", titulo: "Multa (R$)", tipo: "moeda", largura: 16 },
        ],
        linhas: autos.map((a) => ({ numero: a.numero, municipio: a.fiscalizacao.municipio.nome, data: a.created_at, autuado: a.autuado.nome, penalidade: a.penalidade, status: a.status, valor: a.valor_multa === null ? null : Number(a.valor_multa) })),
        total: { numero: "Total", valor: totalMultas },
      },
      {
        titulo: "Notificações",
        colunas: [
          { chave: "numero", titulo: "Número", largura: 20 }, { chave: "data", titulo: "Emitida em", tipo: "data", largura: 12 }, { chave: "notificado", titulo: "Notificado", largura: 32 },
          { chave: "exigencia", titulo: "Exigência", largura: 40 }, { chave: "prazo", titulo: "Prazo", tipo: "data", largura: 12 }, { chave: "status", titulo: "Status", largura: 12 },
        ],
        linhas: notificacoes.map((n) => ({ numero: n.numero, data: n.created_at, notificado: n.notificado.nome, exigencia: n.exigencia, prazo: n.prazo_ate, status: n.status })),
      },
    ],
  };
}

async function relProdutividade(e: Escopo): Promise<Relatorio> {
  const fp = sqlFiltroProcesso(e);
  const hoje0 = inicioDoDia(new Date());
  const [linhas, pareceres, conc] = await Promise.all([
    prisma.$queryRaw<{ tecnico_id: string; atribuidos: bigint; vencidos: bigint }[]>`
      SELECT p.tecnico_id,
        COUNT(*) FILTER (WHERE p.data_protocolo BETWEEN ${e.de} AND ${e.ate}) AS atribuidos,
        COUNT(*) FILTER (WHERE p.status::text = ANY(${["PROTOCOLADO", "EM_TRIAGEM", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO"]}) AND NOT p.prazo_pausado AND p.prazo_etapa_ate < ${hoje0}) AS vencidos
      FROM processo p WHERE ${fp} AND p.tecnico_id IS NOT NULL GROUP BY 1`,
    prisma.$queryRaw<{ autor_id: string; total: bigint }[]>`
      SELECT pa.autor_id, COUNT(*) AS total FROM parecer pa JOIN processo p ON p.id = pa.processo_id
      WHERE ${sqlFiltroProcesso(e, { ignorarTecnico: true })} AND pa.created_at BETWEEN ${e.de} AND ${e.ate} ${e.tecnico ? Prisma.sql`AND pa.autor_id = ${e.tecnico.id}::uuid` : Prisma.empty}
      GROUP BY 1`,
    prisma.processo.findMany({
      where: { ...whereProcessos(e), status: "CONCLUIDO", tecnico_id: e.tecnico ? e.tecnico.id : { not: null }, OR: [{ data_conclusao: { gte: e.de, lte: e.ate } }, { data_conclusao: null, updated_at: { gte: e.de, lte: e.ate } }] },
      select: { tecnico_id: true, data_protocolo: true, data_conclusao: true, updated_at: true },
    }),
  ]);
  const ids = [...new Set([...linhas.map((l) => l.tecnico_id), ...pareceres.map((p) => p.autor_id), ...conc.map((c) => c.tecnico_id!)])];
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });
  const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
  const rows = ids.map((id) => {
    const l = linhas.find((x) => x.tecnico_id === id);
    const c = conc.filter((x) => x.tecnico_id === id);
    return {
      tecnico: nome.get(id) ?? "—",
      atribuidos: Number(l?.atribuidos ?? 0),
      concluidos: c.length,
      pareceres: Number(pareceres.find((x) => x.autor_id === id)?.total ?? 0),
      tempo_medio: tempoMedio(c.map((x) => ({ inicio: x.data_protocolo, fim: x.data_conclusao ?? x.updated_at }))),
      vencidos: Number(l?.vencidos ?? 0),
    };
  }).sort((a, b) => a.tecnico.localeCompare(b.tecnico, "pt-BR"));
  const todos = conc.map((x) => ({ inicio: x.data_protocolo, fim: x.data_conclusao ?? x.updated_at }));
  return {
    tipo: "produtividade",
    titulo: titulo("produtividade"),
    paisagem: false,
    filtros: filtrosLegiveis(e),
    secoes: [
      {
        titulo: "Produtividade por técnico",
        colunas: [
          { chave: "tecnico", titulo: "Técnico", largura: 32 },
          { chave: "atribuidos", titulo: "Atribuídos (protocolados no período)", tipo: "inteiro", largura: 18 },
          { chave: "concluidos", titulo: "Concluídos no período", tipo: "inteiro", largura: 14 },
          { chave: "pareceres", titulo: "Pareceres emitidos", tipo: "inteiro", largura: 14 },
          { chave: "tempo_medio", titulo: "Tempo médio (dias)", tipo: "decimal", largura: 14 },
          { chave: "vencidos", titulo: "Prazos vencidos (hoje)", tipo: "inteiro", largura: 14 },
        ],
        linhas: rows,
        total: {
          tecnico: "Total",
          atribuidos: rows.reduce((s, r) => s + r.atribuidos, 0),
          concluidos: rows.reduce((s, r) => s + r.concluidos, 0),
          pareceres: rows.reduce((s, r) => s + r.pareceres, 0),
          tempo_medio: tempoMedio(todos),
          vencidos: rows.reduce((s, r) => s + r.vencidos, 0),
        },
        nota: "Tempo médio = data de protocolo → data de conclusão, em dias corridos. Prazos vencidos: situação atual.",
      },
    ],
  };
}
async function relIndicadores(usuario: UsuarioSessao, filtros: FiltrosIndicadores, e: Escopo): Promise<Relatorio> {
  const ind = await calcularIndicadores(usuario, filtros);
  const t = ind.totais;
  return {
    tipo: "indicadores",
    titulo: titulo("indicadores"),
    paisagem: true,
    filtros: filtrosLegiveis(e),
    resumo: [
      ["Adesão dos municípios", `${fmtNumero(ind.adesao.percentual, 1)}% (${ind.adesao.aderidos} de ${ind.adesao.total}) – meta ≥ ${ind.adesao.meta}%: ${ind.adesao.atingiu ? "atingida" : "não atingida"}`],
    ],
    secoes: [
      {
        titulo: "Indicadores por município",
        colunas: [
          { chave: "nome", titulo: "Município", largura: 18 },
          { chave: "protocolados", titulo: "Protocolados", tipo: "inteiro", largura: 12 },
          { chave: "em_andamento", titulo: "Em andamento", tipo: "inteiro", largura: 12 },
          { chave: "concluidos", titulo: "Concluídos", tipo: "inteiro", largura: 11 },
          { chave: "tempo_medio_dias", titulo: "Tempo médio (dias)", tipo: "decimal", largura: 12 },
          { chave: "prazo_vencido", titulo: "Prazo vencido", tipo: "inteiro", largura: 10 },
          { chave: "prazo_vencendo", titulo: `Vencendo (${DIAS_VENCENDO} d)`, tipo: "inteiro", largura: 11 },
          { chave: "licencas_emitidas", titulo: "Licenças emitidas", tipo: "inteiro", largura: 11 },
          { chave: "licencas_vencendo_90", titulo: "Licenças vencendo (90 d)", tipo: "inteiro", largura: 12 },
          { chave: "denuncias_recebidas", titulo: "Denúncias recebidas", tipo: "inteiro", largura: 11 },
          { chave: "denuncias_apuradas", titulo: "Denúncias apuradas", tipo: "inteiro", largura: 11 },
          { chave: "fiscalizacoes", titulo: "Fiscalizações", tipo: "inteiro", largura: 11 },
          { chave: "autos", titulo: "Autos de infração", tipo: "inteiro", largura: 10 },
          { chave: "multas_total", titulo: "Multas (R$)", tipo: "moeda", largura: 16 },
          { chave: "notificacoes", titulo: "Notificações", tipo: "inteiro", largura: 11 },
          { chave: "usuarios_ativos", titulo: "Usuários ativos", tipo: "inteiro", largura: 10 },
          { chave: "processos_total", titulo: "Processos (total)", tipo: "inteiro", largura: 10 },
          { chave: "adesao", titulo: "Aderiu", largura: 8 },
        ],
        linhas: ind.municipios.map((m) => ({ ...m, adesao: m.aderiu ? "Sim" : "Não" })),
        total: { ...t, nome: "Total", adesao: `${fmtNumero(ind.adesao.percentual, 1)}%` },
        nota: `Protocolados, concluídos, licenças emitidas, denúncias, fiscalizações, autos, multas e notificações: no período. Em andamento, prazos e licenças vencendo: situação atual. Tempo médio: protocolo → conclusão (concluídos no período). Adesão: ≥ 1 usuário ativo e ≥ 1 processo.`,
      },
    ],
  };
}

export async function montarRelatorio(tipo: TipoRelatorio, usuario: UsuarioSessao, filtros: FiltrosIndicadores): Promise<Relatorio> {
  const e = await resolverEscopo(usuario, filtros);
  switch (tipo) {
    case "processos":
      return relProcessos(e);
    case "licencas":
      return relLicencas(e);
    case "fiscalizacao":
      return relFiscalizacao(e);
    case "produtividade":
      return relProdutividade(e);
    case "indicadores":
      return relIndicadores(usuario, filtros, e);
  }
}

