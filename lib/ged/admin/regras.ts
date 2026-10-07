// Regras PURAS da administração de membros do GED (sem banco): último administrador, situação do e-mail informado,
// redefinição de senha. Testadas em tests/unit/ged-admin.test.ts.
import type { GedPapel } from "@prisma/client";
import { z } from "zod";
import { zPapelGed, zUuid } from "../tipos";

export type MembroAdminMin = { id: string; papel: GedPapel; ativo: boolean };

/** Depois da mudança haveria ao menos um GED_ADMIN ativo? (false = a mudança deixaria o cliente sem administrador). */
export function manteraAdminAtivo(membros: readonly MembroAdminMin[], alvoId: string, mudanca: { papel?: GedPapel; ativo?: boolean }): boolean {
  const depois = membros.map((m) => (m.id === alvoId ? { ...m, papel: mudanca.papel ?? m.papel, ativo: mudanca.ativo ?? m.ativo } : m));
  return depois.some((m) => m.papel === "GED_ADMIN" && m.ativo);
}

export type SituacaoEmail =
  | "NOVO" // não existe: cria usuário (senha provisória) + membro
  | "ADICIONAR_AO_GED" // usuário já é desta organização (ex.: licenciamento) mas ainda não é membro do GED
  | "JA_MEMBRO"
  | "JA_MEMBRO_INATIVO"
  | "OUTRA_ORGANIZACAO"; // pertence a outro cliente OU é requerente (organizacao_id nulo): nunca reaproveitar

export function classificarEmail(
  usuario: { organizacao_id: string | null } | null,
  organizacaoId: string,
  membro: { ativo: boolean } | null,
): SituacaoEmail {
  if (!usuario) return "NOVO";
  if (usuario.organizacao_id !== organizacaoId) return "OUTRA_ORGANIZACAO";
  if (!membro) return "ADICIONAR_AO_GED";
  return membro.ativo ? "JA_MEMBRO" : "JA_MEMBRO_INATIVO";
}

export const MENSAGEM_EMAIL: Record<Exclude<SituacaoEmail, "NOVO" | "ADICIONAR_AO_GED">, string> = {
  JA_MEMBRO: "Esta pessoa já é membro do módulo.",
  JA_MEMBRO_INATIVO: "Esta pessoa já foi membro e está inativa. Reative-a na lista de membros.",
  OUTRA_ORGANIZACAO: "Este e-mail já está cadastrado na plataforma em outra organização ou como requerente. Use outro e-mail.",
};

/** A senha só pode ser redefinida pelo GED para quem NÃO tem papel de licenciamento (senão seria tomada de conta) e não é o próprio admin. */
export function podeRedefinirSenha(alvo: { papeis_licenciamento: number; usuario_id: string }, solicitanteId: string): { ok: true } | { ok: false; motivo: string } {
  if (alvo.usuario_id === solicitanteId) return { ok: false, motivo: "Para trocar a sua própria senha use “Alterar senha”." };
  if (alvo.papeis_licenciamento > 0) return { ok: false, motivo: "Este usuário também usa o módulo de licenciamento; a senha deve ser redefinida pelo administrador do licenciamento." };
  return { ok: true };
}

export const zNovoMembro = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(160),
  cargo: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  papel: zPapelGed,
  setor_ids: z.array(zUuid).max(30).default([]),
});
export type NovoMembro = z.infer<typeof zNovoMembro>;

// ───────────── Configurações do cliente ─────────────

export const zConfiguracoes = z.object({
  assinatura_prazo_dias: z.coerce.number().int("Use um número inteiro.").min(1, "Mínimo de 1 dia.").max(365, "Máximo de 365 dias."),
  /** "3, 1, 0" → [3,1,0] */
  lembrete_dias: z.string().trim().max(60).transform((s, ctx) => {
    const itens = s.split(/[\s,;]+/).filter(Boolean);
    const nums = itens.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 90)) {
      ctx.addIssue({ code: "custom", message: "Dias de lembrete: números inteiros de 0 a 90 separados por vírgula (ex.: 3, 1, 0)." });
      return z.NEVER;
    }
    return [...new Set(nums)].sort((a, b) => b - a).slice(0, 10);
  }),
  retencao_acesso_log_dias: z.coerce.number().int("Use um número inteiro.").min(90, "Mínimo de 90 dias.").max(3650, "Máximo de 3650 dias (10 anos)."),
  /** Cota informativa em GB; vazio = sem cota. */
  cota_gb: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().min(0.1, "Mínimo de 0,1 GB.").max(100000).nullable()),
  /** Páginas de OCR por mês: vazio = sem limite; 0 = OCR desligado; ausente = não altera. */
  ocr_cota_paginas_mes: z.preprocess((v) => (v === "" || v === null ? null : v), z.coerce.number().int("Use um número inteiro.").min(0, "Mínimo de 0.").max(10_000_000, "Valor alto demais.").nullable().optional()),
});
export type EntradaConfiguracoes = z.infer<typeof zConfiguracoes>;

export const bytesDeGb = (gb: number | null): bigint | null => (gb === null ? null : BigInt(Math.round(gb * 1024 ** 3)));
export const gbDeBytes = (b: bigint | null | undefined): number | null => (b === null || b === undefined ? null : Number(b) / 1024 ** 3);
