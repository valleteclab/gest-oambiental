import "server-only";
import { Prisma, type FonteAlertaDesmatamento } from "@prisma/client";
import { prisma } from "../db";
import { registrarAuditoria } from "../audit";
import { camada, resolverModelo } from "../geo/camadas";
import { buscarJson } from "../geo/http";
import { limiteMunicipio } from "../geo/ibge";
import { codigoIbgeReal, ufPorCodigoIbge } from "../geo/uf";
import { extrairPoligono, type PoligonoGeo } from "../geo/validar";
import { bboxDe, wktBbox } from "./geo";
import { empreendimentosRelacionados, imoveisCruzados, type EmpreendimentoLocal, type FeicaoCar } from "./cruzar";
import { buscarDeter, buscarMapbiomas, buscarProdes, poligonoDoLimite, tokenMapbiomas, type MunicipioMonitorado } from "./provedores";
import type { AlertaNormalizado } from "./fontes";
import { areaMinimaHa, deveNotificar, sugerirStatus, type Cruzamento, type DocumentoCruzado, type EmpreendimentoCruzado, type ImovelCruzado } from "./regras";

// Sincronização do monitoramento por satélite (docs/monitoramento.md):
//   1. busca DETER/PRODES (e MapBiomas, se houver token) do município – só códigos IBGE reais (os 99… da demo são pulados);
//   2. upsert idempotente por (fonte, id_externo) – situação e tratamento do técnico nunca são sobrescritos;
//   3. cruzamento: imóveis do CAR (WFS do SICAR, INTERSECTS com o retângulo do alerta + sobreposição exata com turf)
//      e empreendimentos/licenças locais → sugestão AUTORIZADO / POSSÍVEL IRREGULAR;
//   4. aviso no sino para técnicos e fiscais do município (alertas NOVOS com área ≥ MONITORAMENTO_AREA_MINIMA_HA).
// Executada pelo worker (fila `monitoramento-sync`, diária) e pelo botão "Sincronizar agora" (/monitoramento).

export type ResumoFonte = { fonte: FonteAlertaDesmatamento; status: "OK" | "ERRO" | "DESATIVADA"; recebidos: number; novos: number; atualizados: number; erro?: string; metodo?: string };
export type ResumoSync = {
  sync_id: string | null;
  municipio: string;
  status: "OK" | "PARCIAL" | "ERRO" | "IGNORADO" | "EM_ANDAMENTO";
  mensagem?: string;
  fontes: ResumoFonte[];
  cruzados: number;
  com_car: number;
  erros_car: number;
  notificados: number;
  duracao_ms: number;
};

const envNum = (k: string, padrao: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
};
const DIA = 86_400_000;
/** Sincronização "EXECUTANDO" há mais que isso é considerada abandonada (processo reiniciado). */
const LIMITE_EXECUCAO_MS = 45 * 60_000;

// ───────────────────────── CAR (SICAR) ─────────────────────────

const WFS_SICAR = "https://geoserver.car.gov.br/geoserver/sicar/ows";

function urlCar(layer: string, wkt: string) {
  const q = new URLSearchParams({ service: "WFS", version: "1.0.0", request: "GetFeature", typeName: layer, outputFormat: "application/json", maxFeatures: "50", CQL_FILTER: `INTERSECTS(geo_area_imovel,${wkt})` });
  return `${WFS_SICAR}?${q}`;
}

/** Imóveis do CAR que intersectam o alerta. Retângulo do alerta (2 tentativas); se falhar, o centroide. */
export async function consultarCarNaArea(g: PoligonoGeo, centro: { lat: number; lng: number }, uf: string): Promise<{ metodo: "WFS_AREA" | "PONTO"; imoveis: ImovelCruzado[] }> {
  const layer = resolverModelo(camada("car")!.layers!, { uf });
  const tentativas: [string, "WFS_AREA" | "PONTO"][] = [
    [urlCar(layer, wktBbox(bboxDe(g))), "WFS_AREA"],
    [urlCar(layer, wktBbox(bboxDe(g))), "WFS_AREA"],
    [urlCar(layer, `POINT(${centro.lng} ${centro.lat})`), "PONTO"],
  ];
  let erro: unknown = null;
  for (const [url, metodo] of tentativas) {
    try {
      const fc = await buscarJson<{ features?: FeicaoCar[] }>(url, 25_000);
      return { metodo, imoveis: imoveisCruzados(g, fc.features ?? []) };
    } catch (e) {
      erro = e;
    }
  }
  throw erro ?? new Error("SICAR indisponível");
}

// ───────────────────────── Cadastro local ─────────────────────────

export type ContextoLocal = { municipioId: string; emps: EmpreendimentoLocal[] };

export async function contextoLocal(municipioId: string): Promise<ContextoLocal> {
  const emps = await prisma.empreendimento.findMany({
    where: { municipio_id: municipioId },
    select: { id: true, nome: true, numero_car: true, latitude: true, longitude: true, poligono_geojson: true },
  });
  return { municipioId, emps: emps.map((e) => ({ ...e, latitude: e.latitude == null ? null : Number(e.latitude), longitude: e.longitude == null ? null : Number(e.longitude) })) };
}

/** Empreendimentos locais relacionados + processos e licenças/autorizações de cada um. */
async function empreendimentosCruzados(ctx: ContextoLocal, g: PoligonoGeo | null, codsCar: string[]): Promise<EmpreendimentoCruzado[]> {
  const rel = empreendimentosRelacionados(g, codsCar, ctx.emps);
  if (!rel.length) return [];
  const via = new Map(rel.map((r) => [r.id, r.via]));
  const emps = await prisma.empreendimento.findMany({
    where: { id: { in: [...via.keys()] }, municipio_id: ctx.municipioId },
    select: {
      id: true, nome: true, numero_car: true,
      processos: {
        orderBy: { created_at: "desc" }, take: 20,
        select: {
          id: true, numero: true, status: true, tipo_ato: { select: { sigla: true } },
          documentos: { where: { tipo: { in: ["LICENCA", "AUTORIZACAO"] } }, select: { id: true, numero: true, tipo: true, sigla_ato: true, emitido_em: true, validade_ate: true, status: true } },
        },
      },
    },
  });
  return emps.map((e) => ({
    id: e.id, nome: e.nome, numero_car: e.numero_car, via: via.get(e.id)!,
    processos: e.processos.map((p) => ({ id: p.id, numero: p.numero, status: p.status, sigla: p.tipo_ato.sigla })),
    documentos: e.processos.flatMap((p) => p.documentos).map((d): DocumentoCruzado => ({
      id: d.id, numero: d.numero, tipo: d.tipo, sigla_ato: d.sigla_ato, emitido_em: d.emitido_em.toISOString(), validade_ate: d.validade_ate?.toISOString() ?? null, status: d.status,
    })),
  }));
}

/**
 * Cruza um alerta. `consultarCar=false` reaproveita os imóveis do cruzamento anterior (só recalcula a parte local –
 * licenças emitidas/canceladas depois mudam a sugestão sem nova consulta ao SICAR).
 */
export async function cruzarAlerta(
  a: { id: string; geometria: unknown; latitude: unknown; longitude: unknown; data_deteccao: Date; cruzamento: unknown },
  ctx: ContextoLocal,
  uf: string | null,
  consultarCar: boolean,
): Promise<Cruzamento> {
  const g = extrairPoligono(a.geometria);
  const centro = { lat: Number(a.latitude), lng: Number(a.longitude) };
  let car: Cruzamento["car"];
  const anterior = (a.cruzamento ?? null) as Cruzamento | null;
  if (!consultarCar && anterior?.car?.status === "OK") car = anterior.car;
  else if (!g || !uf) car = { status: "NAO_CONSULTADO", erro: !uf ? "UF desconhecida" : "alerta sem geometria", imoveis: [] };
  else {
    try {
      const r = await consultarCarNaArea(g, centro, uf);
      car = { status: "OK", metodo: r.metodo, imoveis: r.imoveis };
    } catch (e) {
      car = { status: "ERRO", erro: String((e as Error)?.message ?? e).slice(0, 200), imoveis: [] };
    }
  }
  return montarCruzamento(ctx, g, car, a.data_deteccao);
}

/** Completa o cruzamento (empreendimentos/licenças locais + sugestão) a partir do resultado do CAR. Sem rede. */
export async function montarCruzamento(ctx: ContextoLocal, g: PoligonoGeo | null, car: Cruzamento["car"], dataDeteccao: Date): Promise<Cruzamento> {
  const empreendimentos = await empreendimentosCruzados(ctx, g, car.imoveis.map((i) => i.cod_imovel));
  const s = sugerirStatus({ car, empreendimentos }, dataDeteccao);
  return { consultado_em: new Date().toISOString(), car, empreendimentos, sugestao: s.sugestao, motivo: s.motivo, documento_sugerido: s.documento };
}

async function emParalelo<T>(itens: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) await fn(itens[i++]);
  }));
}

// ───────────────────────── Upsert ─────────────────────────

const json = (v: unknown) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

async function gravarAlertas(m: { id: string; organizacao_id: string }, alertas: AlertaNormalizado[], r: ResumoFonte, novos: string[]) {
  r.recebidos = alertas.length;
  if (!alertas.length) return;
  const existentes = await prisma.alertaDesmatamento.findMany({
    where: { fonte: r.fonte, id_externo: { in: alertas.map((a) => a.id_externo) } },
    select: { id: true, id_externo: true, municipio_id: true, area_ha: true, data_deteccao: true, classe: true },
  });
  const porId = new Map(existentes.map((e) => [e.id_externo, e]));
  for (const a of alertas) {
    const e = porId.get(a.id_externo);
    const dados = {
      classe: a.classe, data_deteccao: new Date(`${a.data_deteccao}T00:00:00Z`), area_ha: a.area_ha,
      geometria: json(a.geometria), latitude: a.latitude, longitude: a.longitude, dados_fonte: json(a.dados_fonte),
    };
    if (!e) {
      // DETER: o INPE move alertas da tabela corrente (…_curr) para a histórica (…_hist) com outro gid.
      // Mesmo município, data, área (±1%) e centroide (~50 m) → é o mesmo alerta: troca o id_externo, mantém o tratamento.
      const gemeo = a.fonte === "DETER" ? await prisma.alertaDesmatamento.findFirst({
        where: {
          fonte: "DETER", municipio_id: m.id, data_deteccao: dados.data_deteccao, id_externo: { notIn: alertas.map((x) => x.id_externo) },
          area_ha: { gte: a.area_ha * 0.99, lte: a.area_ha * 1.01 },
          latitude: { gte: a.latitude - 0.0005, lte: a.latitude + 0.0005 }, longitude: { gte: a.longitude - 0.0005, lte: a.longitude + 0.0005 },
        },
        select: { id: true, id_externo: true, dados_fonte: true },
      }) : null;
      if (gemeo) {
        const anteriores = [...(((gemeo.dados_fonte ?? {}) as { ids_anteriores?: string[] }).ids_anteriores ?? []), gemeo.id_externo];
        await prisma.alertaDesmatamento.update({ where: { id: gemeo.id }, data: { ...dados, id_externo: a.id_externo, dados_fonte: { ...a.dados_fonte, ids_anteriores: anteriores } as Prisma.InputJsonValue } });
        r.atualizados++;
        continue;
      }
      try {
        const c = await prisma.alertaDesmatamento.create({ data: { organizacao_id: m.organizacao_id, municipio_id: m.id, fonte: a.fonte, id_externo: a.id_externo, status: "NOVO", ...dados }, select: { id: true } });
        novos.push(c.id);
        r.novos++;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err; // corrida com outra execução
      }
      continue;
    }
    if (e.municipio_id !== m.id) continue; // pertence a outro município (nunca move entre clientes)
    const mudou = Number(e.area_ha) !== a.area_ha || e.classe !== a.classe || e.data_deteccao.toISOString().slice(0, 10) !== a.data_deteccao;
    if (mudou) {
      // Fonte revisou o polígono/área: atualiza os dados da fonte e refaz o cruzamento (situação do técnico é mantida).
      await prisma.alertaDesmatamento.update({ where: { id: e.id }, data: { ...dados, cruzado_em: null } });
      r.atualizados++;
    }
  }
}

// ───────────────────────── Avisos (sino) ─────────────────────────

async function destinatarios(m: { id: string; organizacao_id: string }): Promise<string[]> {
  const ps = await prisma.usuarioPapel.findMany({
    where: {
      usuario: { ativo: true, organizacao_id: m.organizacao_id },
      OR: [{ papel: { in: ["TEC_MUNICIPAL", "FISCAL"] }, municipio_id: m.id }, { papel: "TEC_CONSORCIO" }],
    },
    select: { usuario_id: true },
  });
  return [...new Set(ps.map((p) => p.usuario_id))];
}

async function avisar(m: { id: string; nome: string; organizacao_id: string }, syncId: string, novosIds: string[]): Promise<number> {
  if (!novosIds.length) return 0;
  const minima = areaMinimaHa();
  const novos = await prisma.alertaDesmatamento.findMany({ where: { id: { in: novosIds } }, select: { id: true, fonte: true, area_ha: true, status: true, data_deteccao: true } });
  const relevantes = novos.filter((a) => deveNotificar({ status: a.status, area_ha: Number(a.area_ha) }, minima));
  if (!relevantes.length) return 0;
  const usuarios = await destinatarios(m);
  const area = relevantes.reduce((s, a) => s + Number(a.area_ha), 0);
  const um = relevantes.length === 1 ? relevantes[0] : null;
  const mensagem = um
    ? `Novo alerta de desmatamento (${um.fonte}) em ${m.nome}: ${area.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha detectados em ${um.data_deteccao.toISOString().slice(0, 10).split("-").reverse().join("/")}.`
    : `${relevantes.length} novos alertas de desmatamento em ${m.nome} (${area.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha no total, ≥ ${minima} ha cada).`;
  let n = 0;
  for (const uid of usuarios) {
    const ref = um ? um.id : syncId;
    try {
      await prisma.alerta.create({
        data: { usuario_id: uid, municipio_id: m.id, tipo: "DESMATAMENTO", referencia_tipo: um ? "ALERTA_DESMATAMENTO" : "MONITORAMENTO", referencia_id: ref, chave: `DESMATAMENTO:${ref}:${uid}:NOVO:-`, mensagem },
      });
      n++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return n;
}

// ───────────────────────── Execução ─────────────────────────

export type OpcoesSync = { origem: "agendado" | "manual" | "cli"; usuario_id?: string | null; agora?: Date };

/** Sincroniza um município (idempotente). Códigos IBGE fictícios (demo) → IGNORADO sem consultar nada. */
export async function sincronizarMunicipio(municipioId: string, o: OpcoesSync): Promise<ResumoSync> {
  const t0 = Date.now();
  const agora = o.agora ?? new Date();
  const m = await prisma.municipio.findUnique({ where: { id: municipioId }, select: { id: true, nome: true, codigo_ibge: true, organizacao_id: true, ativo: true } });
  const vazio = (status: ResumoSync["status"], mensagem: string): ResumoSync => ({ sync_id: null, municipio: m?.nome ?? municipioId, status, mensagem, fontes: [], cruzados: 0, com_car: 0, erros_car: 0, notificados: 0, duracao_ms: Date.now() - t0 });
  if (!m || !m.ativo) return vazio("IGNORADO", "Município inexistente ou inativo.");
  if (!codigoIbgeReal(m.codigo_ibge)) return vazio("IGNORADO", "Código IBGE fictício (dados de demonstração): as fontes do INPE não têm alertas para este município.");

  const emCurso = await prisma.monitoramentoSync.findFirst({ where: { municipio_id: m.id, status: "EXECUTANDO", iniciado_em: { gte: new Date(Date.now() - LIMITE_EXECUCAO_MS) } }, select: { id: true } });
  if (emCurso) return { ...vazio("EM_ANDAMENTO", "Já existe uma sincronização em andamento para este município."), sync_id: emCurso.id };

  const sync = await prisma.monitoramentoSync.create({ data: { organizacao_id: m.organizacao_id, municipio_id: m.id, origem: o.origem, usuario_id: o.usuario_id ?? null, status: "EXECUTANDO" } });
  const resumo: ResumoSync = { sync_id: sync.id, municipio: m.nome, status: "OK", fontes: [], cruzados: 0, com_car: 0, erros_car: 0, notificados: 0, duracao_ms: 0 };
  const novos: string[] = [];
  try {
    const uf = ufPorCodigoIbge(m.codigo_ibge)!;
    let limite: PoligonoGeo | null = null;
    try {
      limite = poligonoDoLimite(await limiteMunicipio(m.codigo_ibge));
    } catch {
      limite = null; // DETER funciona pelo nome; PRODES registrará o erro
    }
    const alvo: MunicipioMonitorado = { nome: m.nome, uf, limite };
    const desde = new Date(agora.getTime() - envNum("MONITORAMENTO_DETER_MESES", 24) * 30.44 * DIA).toISOString().slice(0, 10);
    const anoMinimo = agora.getUTCFullYear() - envNum("MONITORAMENTO_PRODES_ANOS", 2);

    const fontes: [FonteAlertaDesmatamento, () => Promise<{ alertas: AlertaNormalizado[]; metodo?: string }>][] = [
      ["DETER", () => buscarDeter(alvo, desde)],
      ["PRODES", () => buscarProdes(alvo, anoMinimo)],
    ];
    if (tokenMapbiomas()) fontes.push(["MAPBIOMAS", () => buscarMapbiomas(alvo, desde, agora.toISOString().slice(0, 10))]);
    else resumo.fontes.push({ fonte: "MAPBIOMAS", status: "DESATIVADA", recebidos: 0, novos: 0, atualizados: 0, erro: "MAPBIOMAS_ALERTA_TOKEN não configurado" });

    for (const [fonte, buscar] of fontes) {
      const r: ResumoFonte = { fonte, status: "OK", recebidos: 0, novos: 0, atualizados: 0 };
      resumo.fontes.push(r);
      try {
        const b = await buscar();
        r.metodo = b.metodo;
        await gravarAlertas(m, b.alertas, r, novos);
      } catch (e) {
        r.status = "ERRO";
        r.erro = String((e as Error)?.message ?? e).slice(0, 300);
      }
    }

    // Cruzamento: pendentes (novos, revisados ou com erro no CAR) consultam o SICAR; os demais só recalculam a parte local.
    const ctx = await contextoLocal(m.id);
    const maxCar = envNum("MONITORAMENTO_MAX_CRUZAMENTOS", 800);
    const sel = { id: true, geometria: true, latitude: true, longitude: true, data_deteccao: true, cruzamento: true, cruzado_em: true } as const;
    const pendentes = await prisma.alertaDesmatamento.findMany({
      where: { municipio_id: m.id, OR: [{ cruzado_em: null }, { status_sugerido: "INDETERMINADO" }] },
      orderBy: { data_deteccao: "desc" }, take: maxCar, select: sel,
    });
    const idsPend = new Set(pendentes.map((p) => p.id));
    await emParalelo(pendentes, envNum("MONITORAMENTO_CONCORRENCIA_CAR", 4), async (a) => {
      const c = await cruzarAlerta(a, ctx, uf, true);
      await prisma.alertaDesmatamento.update({ where: { id: a.id }, data: { cruzamento: c as unknown as Prisma.InputJsonValue, status_sugerido: c.sugestao, cruzado_em: new Date() } });
      resumo.cruzados++;
      if (c.car.status !== "OK") resumo.erros_car++;
      if (c.car.imoveis.length) resumo.com_car++;
    });
    const abertos = await prisma.alertaDesmatamento.findMany({ where: { municipio_id: m.id, status: { in: ["NOVO", "EM_ANALISE"] }, cruzado_em: { not: null } }, select: sel });
    for (const a of abertos.filter((x) => !idsPend.has(x.id))) {
      const c = await cruzarAlerta(a, ctx, uf, false);
      const antes = (a.cruzamento ?? {}) as Partial<Cruzamento>;
      if (antes.sugestao !== c.sugestao || JSON.stringify(antes.empreendimentos ?? []) !== JSON.stringify(c.empreendimentos)) {
        await prisma.alertaDesmatamento.update({ where: { id: a.id }, data: { cruzamento: c as unknown as Prisma.InputJsonValue, status_sugerido: c.sugestao, cruzado_em: new Date() } });
      }
    }

    resumo.notificados = await avisar(m, sync.id, novos);
    const erros = resumo.fontes.filter((f) => f.status === "ERRO").length;
    const ativas = resumo.fontes.filter((f) => f.status !== "DESATIVADA").length;
    resumo.status = erros === 0 ? "OK" : erros < ativas ? "PARCIAL" : "ERRO";
  } catch (e) {
    resumo.status = "ERRO";
    resumo.mensagem = String((e as Error)?.message ?? e).slice(0, 500);
  }
  resumo.duracao_ms = Date.now() - t0;
  await prisma.monitoramentoSync.update({
    where: { id: sync.id },
    data: { status: resumo.status, concluido_em: new Date(), resumo: resumo as unknown as Prisma.InputJsonValue, erro: resumo.mensagem ?? (resumo.fontes.find((f) => f.status === "ERRO")?.erro ?? null) },
  });
  await registrarAuditoria({
    usuario_id: o.usuario_id ?? null, acao: "MONITORAMENTO_SINCRONIZAR", entidade: "monitoramento_sync", entidade_id: sync.id,
    depois: { municipio_id: m.id, origem: o.origem, status: resumo.status, fontes: resumo.fontes, cruzados: resumo.cruzados, notificados: resumo.notificados, alertas_novos: novos },
  });
  return resumo;
}

/** Job diário: todos os municípios ativos com código IBGE real (em sequência – respeita os servidores públicos). */
export async function sincronizarTodos(o: OpcoesSync = { origem: "agendado" }): Promise<ResumoSync[]> {
  const ms = await prisma.municipio.findMany({ where: { ativo: true }, select: { id: true, codigo_ibge: true }, orderBy: { nome: "asc" } });
  const r: ResumoSync[] = [];
  for (const m of ms.filter((x) => codigoIbgeReal(x.codigo_ibge))) r.push(await sincronizarMunicipio(m.id, o));
  return r;
}

/** Dispara em segundo plano (botão "Sincronizar agora"): não espera o término; a tela acompanha pela tabela monitoramento_sync. */
export function sincronizarEmSegundoPlano(municipioId: string, o: OpcoesSync) {
  void sincronizarMunicipio(municipioId, o).catch((e) => console.error("[monitoramento] sincronização falhou", e));
}
