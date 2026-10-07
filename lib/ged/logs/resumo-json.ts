// Resumo SEGURO de antes/depois (JSON) do log de alterações: oculta segredos/dados pessoais, limita tamanho. Função pura.
const SENSIVEL = /(senha|segredo|secret|token|pfx|chave|key|otp|hash|cifrad|cpf|cnpj|telefone|phone|email|e_mail|authorization)/i;
const MAX_CAMPOS = 8;
const MAX_TEXTO = 100;

function valor(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > MAX_TEXTO ? `${v.slice(0, MAX_TEXTO)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length > 6 ? `[${v.length} itens]` : valor(JSON.stringify(v));
  if (typeof v === "object") return valor(JSON.stringify(v));
  return "…";
}

export type CampoResumo = { campo: string; valor: string };

/** Lista "campo: valor" (até 8) com segredos/dados pessoais substituídos por "[oculto]". */
export function resumirJson(j: unknown): CampoResumo[] {
  if (j === null || j === undefined) return [];
  if (typeof j !== "object" || Array.isArray(j)) return [{ campo: "valor", valor: valor(j) }];
  const entradas = Object.entries(j as Record<string, unknown>);
  const out = entradas.slice(0, MAX_CAMPOS).map(([k, v]) => ({ campo: k, valor: SENSIVEL.test(k) ? "[oculto]" : valor(v) }));
  if (entradas.length > MAX_CAMPOS) out.push({ campo: "…", valor: `+${entradas.length - MAX_CAMPOS} campo(s)` });
  return out;
}

export const textoResumo = (j: unknown) => resumirJson(j).map((c) => `${c.campo}: ${c.valor}`).join("; ");
