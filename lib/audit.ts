import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

// log_auditoria (SPEC 9.3): toda escrita, login/logout/falhas, emissão/cancelamento, exportação.
export type EntradaAuditoria = {
  usuario_id: string | null;
  acao: string;
  entidade: string;
  entidade_id?: string | null;
  antes?: unknown;
  depois?: unknown;
  ip?: string | null;
  user_agent?: string | null;
  /** Cliente (tenant) do evento – obrigatório para eventos do GED (exportação e consulta por organização). */
  organizacao_id?: string | null;
};

type Cliente = Prisma.TransactionClient | typeof prisma;

const json = (v: unknown) => (v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue));

export async function registrarAuditoria(e: EntradaAuditoria, tx: Cliente = prisma) {
  await tx.logAuditoria.create({
    data: {
      usuario_id: e.usuario_id,
      acao: e.acao,
      entidade: e.entidade,
      entidade_id: e.entidade_id ?? null,
      antes: json(e.antes),
      depois: json(e.depois),
      ip: e.ip ?? null,
      user_agent: e.user_agent ?? null,
      organizacao_id: e.organizacao_id ?? null,
    },
  });
}

/** Versão que captura ip/user-agent da requisição atual (usar em Server Actions/Route Handlers). */
export async function auditar(e: Omit<EntradaAuditoria, "ip" | "user_agent">, tx: Cliente = prisma) {
  let ctx: { ip: string | null; user_agent: string | null } = { ip: null, user_agent: null };
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    ctx = { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, user_agent: h.get("user-agent") };
  } catch {
    /* fora de requisição (jobs/seed) */
  }
  await registrarAuditoria({ ...e, ...ctx }, tx);
}
