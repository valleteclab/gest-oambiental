// Funções puras de agregação dos indicadores (sem acesso a banco) – testadas em tests/unit/indicadores.test.ts.
import type { StatusProcesso } from "@prisma/client";

const DIA_MS = 86400000;
const TZ_OFFSET = "-03:00"; // America/Bahia (sem horário de verão)

/** Status de processo que contam como "em andamento" (protocolado e ainda sem desfecho). */
export const STATUS_EM_ANDAMENTO: StatusProcesso[] = [
  "PROTOCOLADO",
  "EM_TRIAGEM",
  "AGUARDANDO_REQUERENTE",
  "EM_ANALISE",
  "AGUARDANDO_VISTORIA",
  "AGUARDANDO_DECISAO",
  "DEFERIDO",
];

/** Ordem de exibição dos status (fluxo da SPEC 6), sem RASCUNHO. */
export const ORDEM_STATUS: StatusProcesso[] = [...STATUS_EM_ANDAMENTO, "INDEFERIDO", "CONCLUIDO", "ARQUIVADO"];

/** Janela (dias corridos) do "prazo vencendo" – igual à aba "Vencem em 7 dias" da tela Prazos. */
export const DIAS_VENCENDO = 7;
/** Licenças "vencendo" = validade nos próximos 90 dias. */
export const DIAS_LICENCA_VENCENDO = 90;
/** Meta do convênio GAC: ≥ 60% dos municípios aderidos. */
export const META_ADESAO = 60;

/** Diferença em dias (fracionária) entre duas datas. */
export function diasEntre(inicio: Date, fim: Date): number {
  return (fim.getTime() - inicio.getTime()) / DIA_MS;
}

/** Média de dias a partir de soma/quantidade; null quando não há itens. Arredonda para 1 casa. */
export function mediaDias(somaDias: number, quantidade: number): number | null {
  if (!quantidade) return null;
  return Math.round((somaDias / quantidade) * 10) / 10;
}

/** Tempo médio (dias) de uma lista de pares protocolo→conclusão. Pares incompletos são ignorados. */
export function tempoMedio(pares: { inicio: Date | null; fim: Date | null }[]): number | null {
  let soma = 0;
  let n = 0;
  for (const p of pares) {
    if (!p.inicio || !p.fim) continue;
    soma += Math.max(0, diasEntre(p.inicio, p.fim));
    n++;
  }
  return mediaDias(soma, n);
}

/** Percentual (0–100, 1 casa) – 0 quando total = 0. */
export function percentual(parte: number, total: number): number {
  if (!total) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

/** Município aderido = ≥ 1 usuário ativo E ≥ 1 processo. */
export function aderiu(m: { usuarios_ativos: number; processos_total: number }): boolean {
  return m.usuarios_ativos >= 1 && m.processos_total >= 1;
}

export function resumoAdesao(linhas: { usuarios_ativos: number; processos_total: number }[], meta = META_ADESAO) {
  const aderidos = linhas.filter(aderiu).length;
  const pct = percentual(aderidos, linhas.length);
  return { aderidos, total: linhas.length, percentual: pct, meta, atingiu: linhas.length > 0 && pct >= meta };
}

/** Soma campo a campo (numéricos) de uma lista de linhas; usado para a linha "Total". */
export function somarLinhas<T extends Record<string, unknown>>(linhas: T[], campos: (keyof T)[]): Record<keyof T, number> {
  const out = {} as Record<keyof T, number>;
  for (const c of campos) out[c] = linhas.reduce<number>((s, l) => s + (Number(l[c]) || 0), 0);
  return out;
}

/** Converte "aaaa-mm-dd" em Date no início (ou fim) do dia no fuso da Bahia. Retorna null se inválida. */
export function dataFiltro(s: string | null | undefined, fimDoDia = false): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T${fimDoDia ? "23:59:59.999" : "00:00:00.000"}${TZ_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "aaaa-mm-dd" de uma data no fuso da Bahia. */
export function isoDia(d: Date): string {
  return new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}

/** Período padrão: 1º de janeiro do ano corrente até hoje. */
export function periodoPadrao(hoje = new Date()): { de: string; ate: string } {
  const ate = isoDia(hoje);
  return { de: `${ate.slice(0, 4)}-01-01`, ate };
}
