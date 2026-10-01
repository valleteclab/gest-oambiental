// Monitoramento por satélite – regras puras (sem banco/rede), testadas em tests/unit/monitoramento.test.ts.
// Rótulos, cores, transições de status, permissões e a SUGESTÃO de situação a partir do cruzamento com CAR/licenças.
import type { FonteAlertaDesmatamento, StatusAlertaDesmatamento } from "@prisma/client";
import { can, isSomenteLeitura, temPapel, type UsuarioSessao } from "../rbac";

export const ROTULO_FONTE: Record<FonteAlertaDesmatamento, string> = {
  DETER: "DETER Cerrado (INPE)",
  PRODES: "PRODES Cerrado (INPE)",
  MAPBIOMAS: "MapBiomas Alerta",
};

export const ROTULO_STATUS_ALERTA: Record<StatusAlertaDesmatamento, string> = {
  NOVO: "Novo",
  EM_ANALISE: "Em análise",
  AUTORIZADO: "Autorizado",
  IRREGULAR: "Irregular",
  DESCARTADO: "Descartado",
};

/** Cores (mapa e legenda) por situação. */
export const COR_STATUS_ALERTA: Record<StatusAlertaDesmatamento, string> = {
  NOVO: "#dc2626",
  EM_ANALISE: "#f59e0b",
  AUTORIZADO: "#16a34a",
  IRREGULAR: "#7c3aed",
  DESCARTADO: "#64748b",
};

export const COR_BADGE_STATUS_ALERTA: Record<StatusAlertaDesmatamento, "vermelho" | "amarelo" | "verde" | "roxo" | "cinza"> = {
  NOVO: "vermelho",
  EM_ANALISE: "amarelo",
  AUTORIZADO: "verde",
  IRREGULAR: "roxo",
  DESCARTADO: "cinza",
};

export type Sugestao = "AUTORIZADO" | "POSSIVEL_IRREGULAR" | "SEM_CAR" | "INDETERMINADO";

export const ROTULO_SUGESTAO: Record<Sugestao, string> = {
  AUTORIZADO: "Autorizado (licença/ASV local vigente)",
  POSSIVEL_IRREGULAR: "Possível irregularidade (sem autorização local)",
  SEM_CAR: "Fora de imóvel do CAR",
  INDETERMINADO: "Indeterminado (CAR indisponível)",
};

/** Transições manuais permitidas. AUTORIZADO exige vincular licença/ASV; DESCARTADO exige motivo. */
export const TRANSICOES_ALERTA: Record<StatusAlertaDesmatamento, StatusAlertaDesmatamento[]> = {
  NOVO: ["EM_ANALISE", "AUTORIZADO", "IRREGULAR", "DESCARTADO"],
  EM_ANALISE: ["AUTORIZADO", "IRREGULAR", "DESCARTADO", "NOVO"],
  AUTORIZADO: ["EM_ANALISE"],
  IRREGULAR: ["EM_ANALISE"],
  DESCARTADO: ["EM_ANALISE"],
};

export function podeTransicionarAlerta(de: StatusAlertaDesmatamento, para: StatusAlertaDesmatamento): boolean {
  return TRANSICOES_ALERTA[de].includes(para);
}

/** Ver o monitoramento: todo usuário interno com acesso à fiscalização (SEMA/INEMA: somente leitura). */
export const podeVerMonitoramento = (u: UsuarioSessao, municipioId?: string | null) => can(u, "ver", "fiscalizacao", municipioId);

/** Tratar alertas (status, vincular licença, abrir fiscalização): técnicos, fiscais e ADMIN. */
export const podeTratarAlerta = (u: UsuarioSessao, municipioId?: string | null) => !isSomenteLeitura(u) && can(u, "fiscalizar", "fiscalizacao", municipioId);

/** "Sincronizar agora": ADMIN e técnicos (consórcio/municipal). */
export const podeSincronizar = (u: UsuarioSessao, municipioId?: string | null) =>
  !isSomenteLeitura(u) && temPapel(u, "ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL") && can(u, "fiscalizar", "fiscalizacao", municipioId);

/** Área mínima (ha) de um alerta NOVO para avisar técnicos/fiscais no sino (env MONITORAMENTO_AREA_MINIMA_HA, padrão 1). */
export function areaMinimaHa(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.MONITORAMENTO_AREA_MINIMA_HA);
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

// ───────────────────────── Cruzamento ─────────────────────────

export type ImovelCruzado = {
  cod_imovel: string;
  area_imovel_ha: number | null;
  sobreposicao_ha: number;
  /** % da área do alerta dentro do imóvel. */
  percentual_alerta: number;
  situacao: string;
  condicao: string | null;
  tipo: string;
  municipio: string;
};

export type DocumentoCruzado = { id: string; numero: string; tipo: string; sigla_ato: string | null; emitido_em: string; validade_ate: string | null; status: string };

export type EmpreendimentoCruzado = {
  id: string;
  nome: string;
  numero_car: string | null;
  /** Como foi relacionado: mesmo nº do CAR de um imóvel intersectado ou geometria/ponto dentro do alerta. */
  via: "CAR" | "GEOMETRIA";
  processos: { id: string; numero: string | null; status: string; sigla: string }[];
  documentos: DocumentoCruzado[];
};

export type Cruzamento = {
  consultado_em: string;
  car: { status: "OK" | "ERRO" | "NAO_CONSULTADO"; erro?: string; metodo?: "WFS_AREA" | "PONTO"; imoveis: ImovelCruzado[] };
  empreendimentos: EmpreendimentoCruzado[];
  sugestao: Sugestao;
  motivo: string;
  /** Documento que fundamenta a sugestão AUTORIZADO. */
  documento_sugerido?: DocumentoCruzado | null;
};

/** Siglas de ato que podem cobrir a abertura de área (ASV é a específica; licenças/AA → conferir no processo). */
export const SIGLAS_AUTORIZAM_SUPRESSAO = ["ASV", "AA", "LI", "LU", "LAC", "LS", "LO", "RLO"] as const;

const diaIso = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * Documento local (licença/autorização VÁLIDA, emitida até a data de detecção e vigente nela) que cobre o alerta.
 * ASV tem prioridade sobre as demais siglas.
 */
export function documentoQueAutoriza(docs: DocumentoCruzado[], dataDeteccao: string | Date): DocumentoCruzado | null {
  const dia = diaIso(dataDeteccao);
  const validos = docs.filter(
    (d) =>
      d.status === "VALIDO" &&
      (d.tipo === "LICENCA" || d.tipo === "AUTORIZACAO") &&
      !!d.sigla_ato && (SIGLAS_AUTORIZAM_SUPRESSAO as readonly string[]).includes(d.sigla_ato) &&
      diaIso(d.emitido_em) <= dia &&
      (!d.validade_ate || diaIso(d.validade_ate) >= dia),
  );
  const ordem = (s: string | null) => (s === "ASV" ? 0 : s === "AA" ? 1 : 2);
  validos.sort((a, b) => ordem(a.sigla_ato) - ordem(b.sigla_ato) || b.emitido_em.localeCompare(a.emitido_em));
  return validos[0] ?? null;
}

/**
 * Sugestão de situação (nunca aplicada automaticamente – quem decide é o técnico):
 *   AUTORIZADO          – empreendimento local relacionado (CAR/geometria) com ASV/licença válida na data da detecção;
 *   POSSIVEL_IRREGULAR  – área dentro de imóvel(is) do CAR ou de empreendimento local, sem autorização local vigente;
 *   SEM_CAR             – consulta ao CAR ok e nenhum imóvel intersecta a área;
 *   INDETERMINADO       – CAR indisponível e nada local relacionado.
 * Observação: autorizações estaduais (INEMA/SEIA) não estão no sistema municipal – "possível irregularidade" exige conferência.
 */
export function sugerirStatus(c: Pick<Cruzamento, "car" | "empreendimentos">, dataDeteccao: string | Date): { sugestao: Sugestao; motivo: string; documento: DocumentoCruzado | null } {
  const docs = c.empreendimentos.flatMap((e) => e.documentos);
  const doc = documentoQueAutoriza(docs, dataDeteccao);
  if (doc) {
    const emp = c.empreendimentos.find((e) => e.documentos.some((d) => d.id === doc.id));
    return { sugestao: "AUTORIZADO", motivo: `${doc.sigla_ato} nº ${doc.numero} válida na data da detecção${emp ? ` (${emp.nome})` : ""}.`, documento: doc };
  }
  const nImoveis = c.car.imoveis.filter((i) => i.sobreposicao_ha > 0).length;
  if (nImoveis > 0) {
    const cods = c.car.imoveis.slice(0, 2).map((i) => i.cod_imovel).join(", ");
    return { sugestao: "POSSIVEL_IRREGULAR", motivo: `Área em ${nImoveis} imóvel(is) do CAR (${cods}${nImoveis > 2 ? "…" : ""}) sem licença/ASV municipal vigente registrada. Conferir autorizações estaduais (INEMA).`, documento: null };
  }
  if (c.empreendimentos.length > 0) {
    return { sugestao: "POSSIVEL_IRREGULAR", motivo: `Área relacionada a ${c.empreendimentos.map((e) => e.nome).join(", ")} sem licença/ASV vigente na data da detecção.`, documento: null };
  }
  if (c.car.status === "OK") return { sugestao: "SEM_CAR", motivo: "Nenhum imóvel do CAR intersecta a área do alerta (possível área sem cadastro).", documento: null };
  return { sugestao: "INDETERMINADO", motivo: `Consulta ao CAR indisponível${c.car.erro ? ` (${c.car.erro})` : ""}; refazer o cruzamento.`, documento: null };
}

/** O alerta NOVO merece aviso no sino? (área ≥ mínima). */
export function deveNotificar(a: { status: StatusAlertaDesmatamento; area_ha: number }, minimaHa: number): boolean {
  return a.status === "NOVO" && a.area_ha >= minimaHa;
}

/** Indicadores da tela (sobre a lista filtrada). */
export function indicadores(alertas: { area_ha: number; status: StatusAlertaDesmatamento; status_sugerido: string | null; com_car: boolean }[]) {
  const n = alertas.length;
  const area = alertas.reduce((s, a) => s + a.area_ha, 0);
  const comCar = alertas.filter((a) => a.com_car).length;
  const autorizados = alertas.filter((a) => a.status === "AUTORIZADO" || (a.status !== "IRREGULAR" && a.status !== "DESCARTADO" && a.status_sugerido === "AUTORIZADO")).length;
  const validos = alertas.filter((a) => a.status !== "DESCARTADO").length;
  const pct = (x: number, t: number) => (t > 0 ? Math.round((x / t) * 1000) / 10 : null);
  return {
    total: n,
    area_ha: Math.round(area * 100) / 100,
    novos: alertas.filter((a) => a.status === "NOVO").length,
    pct_com_car: pct(comCar, n),
    /** % dos alertas não descartados sem autorização (situação ou sugestão). */
    pct_sem_autorizacao: pct(validos - Math.min(autorizados, validos), validos),
  };
}
