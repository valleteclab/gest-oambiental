import type { Porte } from "@prisma/client";

// Cálculo de porte a partir das faixas da tipologia (SPEC 5.1/5.2).
// faixas_porte: [{porte:'MICRO', ate: 500}, {porte:'PEQUENO', ate: 2000}, ..., {porte:'EXCEPCIONAL', ate: null}]
export type FaixaPorte = { porte: Porte; ate: number | null };

export const PORTES: Porte[] = ["MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"];

export const ROTULO_PORTE: Record<Porte, string> = {
  MICRO: "Micro",
  PEQUENO: "Pequeno",
  MEDIO: "Médio",
  GRANDE: "Grande",
  EXCEPCIONAL: "Excepcional",
};

/** Normaliza o JSON salvo no banco (tolerante a strings/valores ausentes). */
export function lerFaixas(json: unknown): FaixaPorte[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((f): f is { porte: string; ate?: unknown } => !!f && typeof f === "object" && typeof (f as { porte?: unknown }).porte === "string")
    .filter((f) => (PORTES as string[]).includes(f.porte))
    .map((f) => ({ porte: f.porte as Porte, ate: f.ate === null || f.ate === undefined || f.ate === "" ? null : Number(f.ate) }));
}

/**
 * Porte correspondente à grandeza informada: primeira faixa (em ordem crescente de `ate`) com grandeza ≤ ate.
 * Faixa com `ate: null` é o limite aberto (acima de todas). Retorna null se não houver grandeza/faixas válidas.
 */
export function calcularPorte(faixas: unknown, grandeza: number | string | { toString(): string } | null | undefined): Porte | null {
  if (grandeza === null || grandeza === undefined || grandeza === "") return null;
  const g = Number(grandeza.toString());
  if (!Number.isFinite(g) || g < 0) return null;
  const lista = lerFaixas(faixas);
  if (!lista.length) return null;
  const ordenadas = [...lista].sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity));
  const f = ordenadas.find((x) => x.ate === null || g <= x.ate);
  return f ? f.porte : null;
}

/** "MICRO:500|PEQUENO:2000|EXCEPCIONAL" ⇄ faixas */
export function faixasParaTexto(faixas: unknown): string {
  return lerFaixas(faixas)
    .map((f) => (f.ate === null ? f.porte : `${f.porte}:${f.ate}`))
    .join("|");
}

export function textoParaFaixas(texto: string): FaixaPorte[] {
  const itens = texto.split("|").map((s) => s.trim()).filter(Boolean);
  if (!itens.length) throw new Error("Informe ao menos uma faixa de porte.");
  const faixas = itens.map((item) => {
    const [p, v] = item.split(":").map((s) => s.trim());
    const porte = p.toUpperCase();
    if (!(PORTES as string[]).includes(porte)) throw new Error(`Porte inválido: "${p}" (use ${PORTES.join(", ")}).`);
    if (v === undefined || v === "" || v === "*") return { porte: porte as Porte, ate: null };
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new Error(`Limite inválido para ${porte}: "${v}".`);
    return { porte: porte as Porte, ate: n };
  });
  const abertos = faixas.filter((f) => f.ate === null).length;
  if (abertos > 1) throw new Error("Apenas uma faixa pode ficar sem limite superior.");
  const limites = faixas.filter((f) => f.ate !== null).map((f) => f.ate!);
  for (let i = 1; i < limites.length; i++) if (limites[i] <= limites[i - 1]) throw new Error("Os limites das faixas devem ser crescentes.");
  return faixas;
}
