// Paleta dos gráficos (skill dataviz – paleta de referência validada, modo claro).
// Categórica em ordem FIXA (nunca ciclar); cor segue a entidade (sigla), não a posição.
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"] as const;
export const COR_OUTROS = "#a3a29c";
export const TINTA = { primaria: "#0b0b0b", secundaria: "#52514e", suave: "#898781", grade: "#e1e0d9", eixo: "#c3c2b7", superficie: "#ffffff" } as const;

/** Cor fixa por sigla de ato (7 slots + "Outros"). */
const ORDEM_SIGLAS = ["LO", "LI", "LP", "LS", "AA", "CERT_DISP", "LU"] as const;
export function corSigla(sigla: string): string {
  const i = (ORDEM_SIGLAS as readonly string[]).indexOf(sigla);
  return i >= 0 ? SERIES[i] : COR_OUTROS;
}
export function agruparSigla(sigla: string): string {
  return (ORDEM_SIGLAS as readonly string[]).includes(sigla) ? sigla : "Outros";
}
export const SIGLAS_FIXAS: readonly string[] = [...ORDEM_SIGLAS, "Outros"];
