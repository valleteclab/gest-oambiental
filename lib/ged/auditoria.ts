// Auditoria do GED: envolve `auditar()` (lib/audit.ts) sempre com a organização do contexto.
// Toda escrita no GED chama auditarGed() na MESMA transação da escrita (passe `tx`).
import type { Prisma } from "@prisma/client";
import { auditar } from "@/lib/audit";
import type { GedTx } from "./db";
import type { CtxGed } from "./escopo";

export type EntradaAuditoriaGed = {
  /** Convenção: prefixo GED_ (ex.: GED_ACL_CONCEDIDA, GED_SETOR_CRIADO). */
  acao: string;
  entidade: string;
  entidade_id?: string | null;
  antes?: unknown;
  depois?: unknown;
};

export async function auditarGed(ctx: Pick<CtxGed, "usuario" | "organizacao_id">, e: EntradaAuditoriaGed, tx?: GedTx) {
  await auditar(
    { usuario_id: ctx.usuario.id, organizacao_id: ctx.organizacao_id, acao: e.acao, entidade: e.entidade, entidade_id: e.entidade_id ?? null, antes: e.antes, depois: e.depois },
    // LogAuditoria não é um modelo Ged*: o cliente escopado o repassa sem alterar; o cast só acalma o tipo do Prisma estendido.
    tx as unknown as Prisma.TransactionClient | undefined,
  );
}
