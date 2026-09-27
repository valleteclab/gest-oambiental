// Colunas @db.Date (sem hora) são gravadas como meia-noite UTC: formatar/gerar sempre em UTC,
// senão o fuso da Bahia (-03) exibe o dia anterior.
const TZ = "America/Bahia";

/** Data de hoje no fuso da Bahia, como meia-noite UTC (para colunas @db.Date). */
export function hojeDataPura(agora = new Date()): Date {
  return new Date(`${agora.toLocaleDateString("en-CA", { timeZone: TZ })}T00:00:00Z`);
}

/** dd/mm/aaaa de uma coluna @db.Date. */
export function fmtDataPura(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const iso = new Date(d).toISOString().slice(0, 10);
  const [a, m, dia] = iso.split("-");
  return `${dia}/${m}/${a}`;
}
