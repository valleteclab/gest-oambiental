// Cálculo de prazos em dias corridos ou úteis (fins de semana + feriados) – SPEC 6.1
const DIA = 86400000;

export const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const chave = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function ehDiaUtil(d: Date, feriados: Set<string>): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !feriados.has(chave(d));
}

export function conjuntoFeriados(datas: Date[]): Set<string> {
  return new Set(datas.map((d) => chave(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))));
}

/** Soma `dias` a partir de `inicio`. Em dias úteis, pula fins de semana e feriados. */
export function somarDias(inicio: Date, dias: number, uteis: boolean, feriados: Set<string> = new Set()): Date {
  const base = inicioDoDia(inicio);
  if (!uteis) return new Date(base.getTime() + dias * DIA + (DIA - 1000)); // fim do dia
  let d = base;
  let restantes = dias;
  while (restantes > 0) {
    d = new Date(d.getTime() + DIA);
    if (ehDiaUtil(d, feriados)) restantes--;
  }
  return new Date(d.getTime() + (DIA - 1000));
}

/** Dias (corridos ou úteis) entre hoje e `ate`; negativo se vencido. */
export function diasRestantes(ate: Date, uteis = false, feriados: Set<string> = new Set(), hoje = new Date()): number {
  const a = inicioDoDia(hoje);
  const b = inicioDoDia(ate);
  if (!uteis) return Math.round((b.getTime() - a.getTime()) / DIA);
  const sinal = b >= a ? 1 : -1;
  let n = 0;
  for (let d = a; sinal > 0 ? d < b : d > b; d = new Date(d.getTime() + sinal * DIA)) {
    const prox = new Date(d.getTime() + sinal * DIA);
    if (ehDiaUtil(prox, feriados)) n += sinal;
  }
  return n;
}

export type Semaforo = "verde" | "amarelo" | "vermelho" | "cinza";

/**
 * Semáforo do prazo: vermelho (vencido), amarelo (vence em até `diasAlerta`), verde (em dia),
 * cinza (sem prazo ou relógio pausado). `hoje` e `uteis/feriados` são opcionais (testes / dias úteis).
 */
export function semaforo(
  ate: Date | null | undefined,
  diasAlerta = 5,
  pausado = false,
  hoje: Date = new Date(),
  uteis = false,
  feriados: Set<string> = new Set(),
): Semaforo {
  if (!ate || pausado) return "cinza";
  const r = diasRestantes(ate, uteis, feriados, hoje);
  if (r < 0) return "vermelho";
  if (r <= diasAlerta) return "amarelo";
  return "verde";
}

/** Texto curto para exibir o saldo: "vence hoje", "3 dias", "vencido há 2 dias". */
export function rotuloDiasRestantes(r: number | null | undefined): string {
  if (r === null || r === undefined) return "—";
  if (r === 0) return "vence hoje";
  if (r > 0) return `${r} dia${r === 1 ? "" : "s"}`;
  return `vencido há ${-r} dia${r === -1 ? "" : "s"}`;
}
