import type { Prisma, TipoAto } from "@prisma/client";
import { prisma } from "./db";
import { conjuntoFeriados, somarDias, diasRestantes } from "./dias";

// Motor de prazos (SPEC 6.1). Etapas configuradas em prazo_config (município sobrepõe organização).
export type Etapa = "TRIAGEM" | "ANALISE_CURTA" | "ANALISE_LONGA" | "PENDENCIA" | "VISTORIA" | "DECISAO";

type Cliente = Prisma.TransactionClient | typeof prisma;

const PADRAO: Record<Etapa, { dias: number; dias_alerta: number; conta_dias_uteis: boolean }> = {
  TRIAGEM: { dias: 5, dias_alerta: 2, conta_dias_uteis: true },
  ANALISE_CURTA: { dias: 30, dias_alerta: 5, conta_dias_uteis: false },
  ANALISE_LONGA: { dias: 60, dias_alerta: 5, conta_dias_uteis: false },
  PENDENCIA: { dias: 30, dias_alerta: 5, conta_dias_uteis: false },
  VISTORIA: { dias: 15, dias_alerta: 3, conta_dias_uteis: true },
  DECISAO: { dias: 10, dias_alerta: 3, conta_dias_uteis: true },
};

/** Análise curta (30 d) para LS/AA/CERT/DECL/LAC; longa (60 d) para LP/LI/LO/LU/RLO/ASV. */
export function etapaAnalise(tipoAto: Pick<TipoAto, "sigla" | "prazo_analise_dias">): Etapa {
  return tipoAto.prazo_analise_dias <= 30 ? "ANALISE_CURTA" : "ANALISE_LONGA";
}

export async function configPrazo(tx: Cliente, organizacaoId: string, municipioId: string | null, etapa: Etapa) {
  const cfgs = await tx.prazoConfig.findMany({ where: { organizacao_id: organizacaoId, etapa, OR: [{ municipio_id: municipioId }, { municipio_id: null }] } });
  const c = cfgs.find((x) => x.municipio_id === municipioId) ?? cfgs.find((x) => x.municipio_id === null);
  return c ? { dias: c.dias, dias_alerta: c.dias_alerta, conta_dias_uteis: c.conta_dias_uteis } : PADRAO[etapa];
}

export async function feriadosDe(tx: Cliente, municipioId: string | null) {
  const f = await tx.feriado.findMany({ where: { OR: [{ municipio_id: null }, ...(municipioId ? [{ municipio_id: municipioId }] : [])] }, select: { data: true } });
  return conjuntoFeriados(f.map((x) => x.data));
}

/**
 * Data-limite da etapa a partir de `inicio` (ou saldo de dias, quando retomando de pausa).
 * `uteis` sobrepõe a contagem em dias úteis da etapa (ex.: prazo próprio das demandas urbanas – lib/demandas).
 */
export async function calcularPrazo(tx: Cliente, p: { organizacao_id: string; municipio_id: string; etapa: Etapa; inicio?: Date; dias?: number; uteis?: boolean }) {
  const base = await configPrazo(tx, p.organizacao_id, p.municipio_id, p.etapa);
  const cfg = p.uteis === undefined ? base : { ...base, conta_dias_uteis: p.uteis };
  const feriados = cfg.conta_dias_uteis ? await feriadosDe(tx, p.municipio_id) : new Set<string>();
  const dias = p.dias ?? cfg.dias;
  return { ...cfg, ate: somarDias(p.inicio ?? new Date(), dias, cfg.conta_dias_uteis, feriados), dias };
}

/** Saldo de dias corridos até o prazo (usado ao pausar o relógio em AGUARDANDO_REQUERENTE). */
export function saldoDias(ate: Date | null | undefined): number | null {
  if (!ate) return null;
  return Math.max(0, diasRestantes(ate));
}
