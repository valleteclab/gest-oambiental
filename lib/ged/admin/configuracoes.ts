// Configurações do cliente no GED (GedConfig – 1 por cliente): prazo padrão de assinatura, dias de lembrete, retenção do log de
// acesso e cota informativa. Somente GED_ADMIN; auditado.
import type { Prisma } from "@prisma/client";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../escopo";
import { RETENCAO_PADRAO_DIAS } from "../logs/retencao";
import { exigirAdmin } from "./membros";
import { bytesDeGb, gbDeBytes, zConfiguracoes } from "./regras";

export type ConfiguracoesView = { assinatura_prazo_dias: number; lembrete_dias: number[]; retencao_acesso_log_dias: number; cota_gb: number | null };

export const CONFIGURACAO_PADRAO: ConfiguracoesView = { assinatura_prazo_dias: 15, lembrete_dias: [3, 1, 0], retencao_acesso_log_dias: RETENCAO_PADRAO_DIAS, cota_gb: null };

export async function lerConfiguracoes(ctx: CtxGed): Promise<ConfiguracoesView> {
  exigirAdmin(ctx);
  const c = await ctx.db.gedConfig.findFirst({ select: { assinatura_prazo_dias: true, lembrete_dias: true, retencao_acesso_log_dias: true, cota_bytes: true } });
  if (!c) return CONFIGURACAO_PADRAO;
  return { assinatura_prazo_dias: c.assinatura_prazo_dias, lembrete_dias: c.lembrete_dias, retencao_acesso_log_dias: c.retencao_acesso_log_dias, cota_gb: gbDeBytes(c.cota_bytes) };
}

export async function salvarConfiguracoes(ctx: CtxGed, entrada: unknown): Promise<void> {
  exigirAdmin(ctx);
  const e = zConfiguracoes.parse(entrada);
  const antes = await lerConfiguracoes(ctx);
  const dados = { assinatura_prazo_dias: e.assinatura_prazo_dias, lembrete_dias: e.lembrete_dias, retencao_acesso_log_dias: e.retencao_acesso_log_dias, cota_bytes: bytesDeGb(e.cota_gb) };
  await ctx.db.$transaction(async (tx) => {
    await tx.gedConfig.upsert({ where: { organizacao_id: ctx.organizacao_id }, create: dados as Prisma.GedConfigUncheckedCreateInput, update: dados });
    await auditarGed(ctx, {
      acao: "GED_CONFIGURACAO_ALTERADA", entidade: "ged_config", entidade_id: ctx.organizacao_id, antes,
      depois: { assinatura_prazo_dias: e.assinatura_prazo_dias, lembrete_dias: e.lembrete_dias, retencao_acesso_log_dias: e.retencao_acesso_log_dias, cota_gb: e.cota_gb },
    }, tx);
  });
}
