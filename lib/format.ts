// Formatação pt-BR (DoD: datas dd/mm/aaaa, moeda R$)
const TZ = "America/Bahia";

export function fmtData(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { timeZone: TZ });
}

export function fmtDataHora(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

export function fmtMoeda(v: number | string | { toString(): string } | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number(v.toString()).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtNumero(v: number | string | { toString(): string } | null | undefined, casas = 0): string {
  if (v === null || v === undefined) return "—";
  return Number(v.toString()).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
