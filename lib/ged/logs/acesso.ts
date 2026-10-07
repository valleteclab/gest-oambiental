// Log de acesso do GED (item 11 do edital): quem viu/baixou/buscou/foi negado, com ip e user-agent.
// Nunca derruba o fluxo do chamador: falha de gravação vai para o console.
import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import type { AcaoAcessoGed, CtxGed, RegistrarAcessoInput } from "../contratos";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ip (primeiro de x-forwarded-for) e user-agent da requisição atual; vazio fora de requisição (jobs/testes). */
async function origemDaRequisicao(): Promise<{ ip: string | null; user_agent: string | null }> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "").slice(0, 64) || null;
    const ua = (h.get("user-agent") ?? "").slice(0, 300) || null;
    return { ip, user_agent: ua };
  } catch {
    return { ip: null, user_agent: null };
  }
}

/**
 * Registra um acesso. Em NEGADO o id vem do que o usuário tentou acessar (pode ser de outro cliente ou inventado):
 * só é gravado se o documento/versão pertencer ao cliente; senão fica nulo (o log não vira canal de enumeração entre clientes).
 */
export async function registrarAcesso(ctx: CtxGed, acao: AcaoAcessoGed, input: RegistrarAcessoInput = {}): Promise<void> {
  try {
    let documentoId = input.documento_id && RE_UUID.test(input.documento_id) ? input.documento_id : null;
    let versaoId = input.versao_id && RE_UUID.test(input.versao_id) ? input.versao_id : null;
    if (acao === "NEGADO") {
      if (documentoId && !(await ctx.db.gedDocumento.findFirst({ where: { id: documentoId }, select: { id: true } }))) documentoId = null;
      if (versaoId && !(await ctx.db.gedVersaoDocumento.findFirst({ where: { id: versaoId }, select: { id: true } }))) versaoId = null;
    }
    const origem = await origemDaRequisicao();
    await ctx.db.gedAcessoLog.create({
      data: { usuario_id: ctx.usuario.id, documento_id: documentoId, versao_id: versaoId, acao, ip: origem.ip, user_agent: origem.user_agent } as Prisma.GedAcessoLogUncheckedCreateInput,
    });
  } catch (e) {
    console.error("[ged] falha ao registrar acesso:", e instanceof Error ? e.message : e);
  }
}
