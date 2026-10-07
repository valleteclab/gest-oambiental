// HTTP das rotas PÚBLICAS do compartilhamento: cabeçalhos sem cache/indexação, cookie de sessão com escopo de caminho e IP/navegador.
import { NextResponse } from "next/server";
import { ipDaRequisicao } from "@/lib/limite-login";
import { NOME_COOKIE_SESSAO, SESSAO_TETO_MS } from "./regras";

export const CABECALHOS_COMPARTILHADO = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

export const jsonCompartilhado = (corpo: unknown, status = 200, extra: Record<string, string | string[]> = {}) => {
  const r = NextResponse.json(corpo, { status, headers: CABECALHOS_COMPARTILHADO });
  for (const [k, v] of Object.entries(extra)) for (const x of Array.isArray(v) ? v : [v]) r.headers.append(k, x);
  return r;
};

export type MetaPublica = { ip: string; user_agent: string | null };
export const metaDaRequisicao = (h: { get(nome: string): string | null }): MetaPublica => ({ ip: ipDaRequisicao(h), user_agent: h.get("user-agent")?.slice(0, 400) ?? null });

/** Cookie Secure sempre que o acesso for HTTPS (direto ou atrás do proxy). Em http (dev/E2E local) o navegador descartaria o cookie. */
export function conexaoSegura(req: { url: string; headers: { get(nome: string): string | null } }): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Dois caminhos (página e API do mesmo token): o cookie nunca vai para outro link nem para o resto do sistema. */
export const caminhosCookie = (token: string) => [`/compartilhado/${token}`, `/api/v1/publico/compartilhado/${token}`] as const;

export function cookiesSessao(token: string, valor: string | null, seguro: boolean): string[] {
  return caminhosCookie(token).map((path) => {
    const partes = [`${NOME_COOKIE_SESSAO}=${valor ?? ""}`, `Path=${path}`, "HttpOnly", "SameSite=Lax", valor ? `Max-Age=${Math.floor(SESSAO_TETO_MS / 1000)}` : "Max-Age=0"];
    if (seguro) partes.push("Secure");
    return partes.join("; ");
  });
}

/** Lê o cookie de sessão do cabeçalho Cookie (rotas) – a página usa next/headers. */
export function lerCookieSessao(h: { get(nome: string): string | null }): string | null {
  const bruto = h.get("cookie");
  if (!bruto) return null;
  for (const p of bruto.split(";")) {
    const [k, ...v] = p.trim().split("=");
    if (k === NOME_COOKIE_SESSAO) return v.join("=") || null;
  }
  return null;
}
