// Varredura horária (jobs/ged-assinaturas.ts): lembretes, expiração e reconciliação de selos pendentes.
// Descobre as solicitações abertas entre os clientes por solicitacoesAbertasEntreClientes() (só ids) e processa cada uma
// com o escopo do respectivo cliente (gedDb via ctx). Idempotente: pode rodar em mais de uma réplica.
import "server-only";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../contratos";
import { gedDb, solicitacoesAbertasEntreClientes } from "../db";
import { ctxGedPorUsuarioId } from "../escopo";
import { avisar } from "./ponte";
import { fmtDataHoraBrasilia, lembreteDevido, prazoExpirado, todosAssinaram } from "./regras";
import { selarDocumento } from "./selo";

export type ResultadoVarredura = { examinadas: number; lembretes: number; expiradas: number; seladas: number; erros: number };

/** Contexto técnico do cliente para o job: o autor da solicitação; se inativo, um administrador ativo do GED. */
async function ctxDoJob(orgId: string, autorId: string): Promise<CtxGed | null> {
  const direto = await ctxGedPorUsuarioId(autorId);
  if (direto && direto.organizacao_id === orgId) return direto;
  const admins = await gedDb(orgId).gedMembro.findMany({ where: { papel: "GED_ADMIN", ativo: true }, select: { usuario_id: true }, take: 5 });
  for (const a of admins) {
    const c = await ctxGedPorUsuarioId(a.usuario_id);
    if (c && c.organizacao_id === orgId) return c;
  }
  return null;
}

export async function processarSolicitacao(orgId: string, solId: string, agora = new Date()): Promise<"lembrete" | "expirada" | "selada" | "nada" | "ignorada"> {
  const db = gedDb(orgId);
  const sol = await db.gedSolicitacaoAssinatura.findUnique({ where: { id: solId }, include: { assinantes: true } });
  if (!sol || sol.status !== "ABERTA") return "ignorada";
  const ctx = await ctxDoJob(orgId, sol.criada_por_id);
  if (!ctx) return "ignorada";

  // todos assinaram mas o selo não foi gravado (falha temporária): conclui
  if (todosAssinaram(sol.assinantes)) {
    await selarDocumento(ctx, sol.id);
    return "selada";
  }

  if (prazoExpirado(sol.prazo_em, agora)) {
    const ok = await ctx.db.$transaction(async (tx) => {
      const trava = await tx.gedSolicitacaoAssinatura.update({ where: { id: sol.id }, data: { updated_at: new Date() }, select: { status: true } });
      if (trava.status !== "ABERTA") return false;
      await tx.gedSolicitacaoAssinatura.update({ where: { id: sol.id }, data: { status: "EXPIRADA", concluida_em: agora } });
      const pend = await tx.gedAssinante.findMany({ where: { solicitacao_id: sol.id, status: { in: ["PENDENTE", "AGUARDANDO"] } }, select: { id: true } });
      // updateMany por status: nunca toca linha já decidida (trigger do banco bloqueia ASSINADO/RECUSADO)
      await tx.gedAssinante.updateMany({ where: { solicitacao_id: sol.id, status: { in: ["PENDENTE", "AGUARDANDO"] } }, data: { status: "EXPIRADO" } });
      await tx.gedDocumento.updateMany({ where: { id: sol.documento_id, status: "EM_ASSINATURA" }, data: { status: "PUBLICADO" } });
      await avisar(tx, ctx, "ASSINATURA_EXPIRADA", { usuario_ids: [sol.criada_por_id], documento_id: sol.documento_id, dados: { prazo: fmtDataHoraBrasilia(sol.prazo_em), pendentes: String(pend.length) } });
      await auditarGed(ctx, { acao: "GED_ASSINATURA_EXPIRADA", entidade: "ged_solicitacao_assinatura", entidade_id: sol.id, antes: { status: "ABERTA" }, depois: { status: "EXPIRADA", pendentes: pend.length, prazo_em: sol.prazo_em } }, tx);
      return true;
    });
    return ok ? "expirada" : "ignorada";
  }

  const cfg = await db.gedConfig.findFirst({ select: { lembrete_dias: true } });
  const dias = cfg?.lembrete_dias?.length ? cfg.lembrete_dias : [3, 1, 0];
  let enviados = 0;
  for (const a of sol.assinantes.filter((x) => x.status === "PENDENTE")) {
    if (!lembreteDevido({ prazo_em: sol.prazo_em, agora, criada_em: sol.created_at, ultimo_lembrete_em: a.ultimo_lembrete_em, lembrete_dias: dias })) continue;
    await ctx.db.$transaction(async (tx) => {
      // compare-and-set: duas réplicas não enviam o mesmo lembrete
      const r = await tx.gedAssinante.updateMany({ where: { id: a.id, status: "PENDENTE", ultimo_lembrete_em: a.ultimo_lembrete_em }, data: { ultimo_lembrete_em: agora } });
      if (r.count !== 1) return;
      await avisar(tx, ctx, "ASSINATURA_LEMBRETE", { usuario_ids: [a.usuario_id], documento_id: sol.documento_id, assinante_id: a.id, dados: { prazo: fmtDataHoraBrasilia(sol.prazo_em) } });
      enviados++;
    });
  }
  return enviados > 0 ? "lembrete" : "nada";
}

export async function varrerAssinaturas(agora = new Date()): Promise<ResultadoVarredura> {
  const abertas = await solicitacoesAbertasEntreClientes();
  const r: ResultadoVarredura = { examinadas: abertas.length, lembretes: 0, expiradas: 0, seladas: 0, erros: 0 };
  for (const s of abertas) {
    try {
      const o = await processarSolicitacao(s.organizacao_id, s.id, agora);
      if (o === "lembrete") r.lembretes++;
      else if (o === "expirada") r.expiradas++;
      else if (o === "selada") r.seladas++;
    } catch (e) {
      r.erros++;
      console.error("[ged-assinaturas] falha", s.id, e instanceof Error ? e.message : e);
    }
  }
  return r;
}
