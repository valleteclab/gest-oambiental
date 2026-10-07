// Limites de tentativa do ato de assinar (senha) e da consulta pública – janela deslizante em memória, nos moldes de
// lib/limite-login.ts (mesma observação: por processo; com várias réplicas limite também no proxy/WAF).
import { ErroApi } from "@/lib/http";
import { ipBloqueado, ipDaRequisicao, registrarFalhaIp, segundosParaLiberar } from "@/lib/limite-login";
import type { MetaRequisicao } from "./validacao";

export const SENHA_MAX_FALHAS = 5;
export const SENHA_JANELA_MS = 15 * 60_000;
const IP_MAX_FALHAS = 20;

const chaveUsuario = (id: string) => `ged-assinar:u:${id}`;
const chaveIp = (ip: string) => `ged-assinar:ip:${ip}`;
const semIp = (ip: string | null): ip is string => !!ip && ip !== "desconhecido";

/** Lança 429 se o usuário (ou o IP) estourou as tentativas de senha na janela. */
export function exigirSemBloqueioSenha(usuarioId: string, ip: string | null, agora = Date.now()) {
  if (ipBloqueado(chaveUsuario(usuarioId), agora, SENHA_MAX_FALHAS, SENHA_JANELA_MS) || (semIp(ip) && ipBloqueado(chaveIp(ip), agora, IP_MAX_FALHAS, SENHA_JANELA_MS))) {
    const seg = Math.max(segundosParaLiberar(chaveUsuario(usuarioId), agora, SENHA_JANELA_MS), 1);
    throw new ErroApi(429, "MUITAS_TENTATIVAS", `Muitas tentativas de senha. Aguarde ${Math.ceil(seg / 60)} minuto(s) e tente de novo.`);
  }
}

/** Registra senha incorreta; devolve quantas tentativas ainda restam antes do bloqueio. */
export function registrarFalhaSenha(usuarioId: string, ip: string | null, agora = Date.now()): number {
  const n = registrarFalhaIp(chaveUsuario(usuarioId), agora, SENHA_JANELA_MS);
  if (semIp(ip)) registrarFalhaIp(chaveIp(ip), agora, SENHA_JANELA_MS);
  return Math.max(0, SENHA_MAX_FALHAS - n);
}

/** IP e navegador a partir dos cabeçalhos (evidência da assinatura). */
export function metaDosCabecalhos(h: { get(nome: string): string | null }): MetaRequisicao {
  const ip = ipDaRequisicao(h);
  return { ip: ip === "desconhecido" ? null : ip.slice(0, 64), user_agent: h.get("user-agent")?.slice(0, 300) ?? null };
}

// ───────────── Consulta pública /verificar ─────────────
const VERIF_JANELA_MS = 10 * 60_000;
const VERIF_MAX_REQ = 120;
const VERIF_MAX_FALHAS = 15;

/** true = pode consultar. Conta toda requisição (volume) e, à parte, as que não acharam nada (enumeração de códigos). */
export function permitirConsultaPublica(ip: string, agora = Date.now()): boolean {
  const k = `ged-verificar:req:${ip}`;
  if (ipBloqueado(k, agora, VERIF_MAX_REQ, VERIF_JANELA_MS) || ipBloqueado(`ged-verificar:falha:${ip}`, agora, VERIF_MAX_FALHAS, VERIF_JANELA_MS)) return false;
  registrarFalhaIp(k, agora, VERIF_JANELA_MS);
  return true;
}
export function registrarConsultaSemResultado(ip: string, agora = Date.now()) {
  registrarFalhaIp(`ged-verificar:falha:${ip}`, agora, VERIF_JANELA_MS);
}
