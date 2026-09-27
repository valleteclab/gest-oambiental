import "server-only";
import { revalidatePath } from "next/cache";
import type { UsuarioSessao } from "@/lib/rbac";
import { erroParaEstado, exigirAdmin, type EstadoAcao } from "./guard";

/**
 * Envelope das Server Actions do admin: exige ADMIN, executa, revalida e devolve estado para o formulário.
 * `fn` pode retornar uma mensagem de sucesso (ou objeto com mensagem + extra).
 */
export async function acaoAdmin(caminho: string | string[], fn: (u: UsuarioSessao) => Promise<string | { mensagem: string; extra?: Record<string, string> } | void>): Promise<EstadoAcao> {
  try {
    const u = await exigirAdmin();
    const r = await fn(u);
    for (const c of Array.isArray(caminho) ? caminho : [caminho]) revalidatePath(c);
    if (r && typeof r === "object") return { ok: true, ...r };
    return { ok: true, mensagem: r || "Alterações salvas." };
  } catch (e) {
    return erroParaEstado(e);
  }
}

// Leitura tolerante de FormData
export const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const txtOuNulo = (f: FormData, k: string) => txt(f, k) || null;
export const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "1" || f.get(k) === "true";
export function int(f: FormData, k: string, min = 0, max = 100000): number {
  const n = Number(txt(f, k));
  if (!Number.isInteger(n) || n < min || n > max) throw Object.assign(new Error(`Valor inválido para "${k}" (inteiro entre ${min} e ${max}).`), { status: 422, code: "INVALIDO", details: { campo: k } });
  return n;
}
export function intOuNulo(f: FormData, k: string, min = 0, max = 100000): number | null {
  return txt(f, k) === "" ? null : int(f, k, min, max);
}
export function decOuNulo(f: FormData, k: string, min: number, max: number): number | null {
  const v = txt(f, k).replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw Object.assign(new Error(`Valor inválido para "${k}".`), { status: 422, code: "INVALIDO", details: { campo: k } });
  return n;
}
export function obrigatorio(f: FormData, k: string, rotulo: string): string {
  const v = txt(f, k);
  if (!v) throw Object.assign(new Error(`Informe ${rotulo}.`), { status: 422, code: "INVALIDO", details: { campo: k } });
  return v;
}
