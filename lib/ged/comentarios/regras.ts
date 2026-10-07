// Regras PURAS de comentários (sem banco) – tests/unit/ged-comentarios.test.ts.
import { invalido } from "@/lib/http";

export const CONTEXTOS_COMENTARIO = ["GERAL", "ASSINATURA", "RECUSA", "TRAMITE"] as const;
export const ROTULO_CONTEXTO_COMENTARIO: Record<(typeof CONTEXTOS_COMENTARIO)[number], string> = {
  GERAL: "Geral",
  ASSINATURA: "Assinatura",
  RECUSA: "Recusa",
  TRAMITE: "Trâmite",
};
export const MAX_COMENTARIO = 4000;
/** Limite de comentários por usuário por janela (anti-abuso; mensagem amigável). */
export const LIMITE_COMENTARIOS = { max: 20, janela_ms: 60_000 } as const;

/** Normaliza (quebras de linha \n, sem espaços nas pontas, sem caracteres de controle) e valida. */
export function normalizarTextoComentario(v: unknown): string {
  const t = String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!t) throw invalido("Escreva o comentário.");
  if (t.length > MAX_COMENTARIO) throw invalido(`O comentário deve ter no máximo ${MAX_COMENTARIO} caracteres.`);
  return t;
}

export function validarContexto(c: unknown): (typeof CONTEXTOS_COMENTARIO)[number] {
  if (!CONTEXTOS_COMENTARIO.includes(c as never)) throw invalido("Contexto de comentário inválido.");
  return c as (typeof CONTEXTOS_COMENTARIO)[number];
}

/** Excedeu o limite? `recentes` = quantos comentários o usuário fez na janela. */
export const excedeuLimite = (recentes: number) => recentes >= LIMITE_COMENTARIOS.max;
export const MENSAGEM_LIMITE = "Você enviou muitos comentários em pouco tempo. Aguarde um minuto e tente novamente.";
