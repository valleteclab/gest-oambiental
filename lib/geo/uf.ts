// Unidades da Federação pelo código IBGE (os 2 primeiros dígitos do código do município).
// Usado para escolher a camada estadual do CAR/SICAR e do SIGEF (ex.: sicar_imoveis_ba).

export const UF_POR_CODIGO_IBGE: Readonly<Record<string, string>> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

export const UFS: readonly string[] = Object.values(UF_POR_CODIGO_IBGE);

/** UF ("BA") a partir do código IBGE do município (7 dígitos) ou do estado (2 dígitos). Null se desconhecido. */
export function ufPorCodigoIbge(codigo: string | number | null | undefined): string | null {
  if (codigo === null || codigo === undefined) return null;
  const s = String(codigo).trim();
  if (!/^\d{2}(\d{5})?$/.test(s)) return null;
  return UF_POR_CODIGO_IBGE[s.slice(0, 2)] ?? null;
}

/** Normaliza/valida uma sigla de UF ("ba" → "BA"); null se inválida. */
export function normalizarUf(uf: string | null | undefined): string | null {
  const s = (uf ?? "").trim().toUpperCase();
  return UFS.includes(s) ? s : null;
}

/** Código IBGE de município real (7 dígitos com UF válida) – os códigos fictícios da demonstração (99…) não são. */
export function codigoIbgeReal(codigo: string | null | undefined): boolean {
  return !!codigo && /^\d{7}$/.test(codigo) && ufPorCodigoIbge(codigo) !== null;
}

/**
 * UF do município para os mapas: pelo código IBGE; se o código não for real (dados de demonstração),
 * usa a UF padrão configurada (MAPAS_UF_PADRAO, padrão "BA").
 */
export function ufDoMunicipio(codigoIbge: string | null | undefined, padrao: string | null | undefined = "BA"): string | null {
  return ufPorCodigoIbge(codigoIbge ?? null) ?? normalizarUf(padrao);
}
