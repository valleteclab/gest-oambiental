export type SP = Promise<Record<string, string | string[] | undefined>>;

export const sp1 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/** Monta querystring preservando filtros. */
export function qs(base: Record<string, string | null | undefined>, extra: Record<string, string | number | null | undefined> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const pagina = (v: string | null) => Math.max(1, Number(v ?? 1) || 1);
