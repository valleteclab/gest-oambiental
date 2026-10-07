// "Minhas notificações": preferências por evento/canal e cadastro/confirmação/revogação do telefone de WhatsApp (opt-in).
// Cada pessoa só mexe nos PRÓPRIOS dados (ctx.usuario); o escopo do cliente vem de ctx.db. Tudo auditado.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { cifrar, decifrar } from "@/lib/crypto";
import { invalido } from "@/lib/http";
import { mascararTelefone, normalizarTelefone } from "@/lib/canais/telefone";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../escopo";
import {
  chaveOptinDoServidor, conferirCodigoOptin, EVENTOS_CONFIGURAVEIS, lerPendente, OPTIN_MAX_TENTATIVAS, OPTIN_VALIDADE_MS, resolverPreferencia, ROTULO_EVENTO,
  serializarPendente, type PreferenciaCanais,
} from "./regras";
import type { EventoGed } from "../contratos";

export type LinhaPreferencia = { evento: EventoGed; rotulo: string } & PreferenciaCanais;
export type EstadoWhatsapp = {
  canal_configurado: boolean;
  situacao: "SEM_TELEFONE" | "AGUARDANDO_CODIGO" | "CONFIRMADO";
  telefone_mascarado: string | null;
  codigo_expira_em: Date | null;
  tentativas_restantes: number | null;
  confirmado_em: Date | null;
};

async function membroDoUsuario(ctx: CtxGed) {
  const m = await ctx.db.gedMembro.findFirst({ where: { usuario_id: ctx.usuario.id, ativo: true }, select: { id: true, telefone_cifrado: true, whatsapp_optin_em: true } });
  if (!m) throw invalido("Seu acesso ao módulo não está ativo.");
  return m;
}

export async function canalWhatsappConfigurado(ctx: CtxGed): Promise<boolean> {
  const cfg = await ctx.db.gedConfig.findFirst({ select: { canal_whatsapp_id: true } });
  if (!cfg?.canal_whatsapp_id) return false;
  return (await ctx.db.canalAtendimento.count({ where: { id: cfg.canal_whatsapp_id, organizacao_id: ctx.organizacao_id, ativo: true } })) > 0;
}

export async function lerPreferencias(ctx: CtxGed): Promise<LinhaPreferencia[]> {
  const regs = await ctx.db.gedPreferenciaNotificacao.findMany({ where: { usuario_id: ctx.usuario.id }, select: { evento: true, email: true, whatsapp: true } });
  const por = new Map(regs.map((r) => [r.evento, r]));
  return EVENTOS_CONFIGURAVEIS.map((evento) => ({ evento, rotulo: ROTULO_EVENTO[evento], ...resolverPreferencia(por.get(evento)) }));
}

const zPreferencias = z.array(z.object({ evento: z.enum(EVENTOS_CONFIGURAVEIS as unknown as [EventoGed, ...EventoGed[]]), email: z.boolean(), whatsapp: z.boolean() })).max(20);

export async function salvarPreferencias(ctx: CtxGed, entrada: unknown): Promise<void> {
  const lista = zPreferencias.parse(entrada);
  await ctx.db.$transaction(async (tx) => {
    const antes = await lerPreferencias(ctx);
    for (const p of lista) {
      const dados = { email: p.email, whatsapp: p.whatsapp };
      await tx.gedPreferenciaNotificacao.upsert({
        where: { usuario_id_evento: { usuario_id: ctx.usuario.id, evento: p.evento } },
        create: { usuario_id: ctx.usuario.id, evento: p.evento, ...dados } as Prisma.GedPreferenciaNotificacaoUncheckedCreateInput,
        update: dados,
      });
    }
    const depois = Object.fromEntries(lista.map((p) => [p.evento, { email: p.email, whatsapp: p.whatsapp }]));
    await auditarGed(ctx, { acao: "GED_PREFERENCIAS_NOTIFICACAO_ALTERADAS", entidade: "ged_preferencia_notificacao", entidade_id: ctx.usuario.id, antes: Object.fromEntries(antes.map((a) => [a.evento, { email: a.email, whatsapp: a.whatsapp }])), depois }, tx);
  });
}

// ───────────── WhatsApp: opt-in ─────────────

export async function estadoWhatsapp(ctx: CtxGed, agora = new Date()): Promise<EstadoWhatsapp> {
  const [m, canal] = await Promise.all([membroDoUsuario(ctx), canalWhatsappConfigurado(ctx)]);
  const conteudo = decifrar(m.telefone_cifrado);
  const pend = lerPendente(conteudo);
  if (pend && !m.whatsapp_optin_em) {
    return {
      canal_configurado: canal, situacao: "AGUARDANDO_CODIGO", telefone_mascarado: mascararTelefone(pend.tel),
      codigo_expira_em: agora.getTime() <= pend.exp ? new Date(pend.exp) : null, tentativas_restantes: Math.max(0, OPTIN_MAX_TENTATIVAS - pend.t), confirmado_em: null,
    };
  }
  if (conteudo && m.whatsapp_optin_em) {
    return { canal_configurado: canal, situacao: "CONFIRMADO", telefone_mascarado: mascararTelefone(conteudo), codigo_expira_em: null, tentativas_restantes: null, confirmado_em: m.whatsapp_optin_em };
  }
  return { canal_configurado: canal, situacao: "SEM_TELEFONE", telefone_mascarado: null, codigo_expira_em: null, tentativas_restantes: null, confirmado_em: null };
}

/** Cadastra o telefone e enfileira o código de 6 dígitos por WhatsApp (evento CONFIRMACAO_WHATSAPP). O opt-in só vale após confirmar. */
export async function solicitarCodigoWhatsapp(ctx: CtxGed, telefoneInformado: string, agora = new Date()): Promise<{ telefone_mascarado: string }> {
  const tel = normalizarTelefone(telefoneInformado);
  if (!tel) throw invalido("Informe um telefone válido com DDD, por exemplo (75) 99999-8888.");
  if (!(await canalWhatsappConfigurado(ctx))) throw invalido("O envio por WhatsApp ainda não foi configurado pelo administrador da sua organização.");
  const m = await membroDoUsuario(ctx);
  const recentes = await ctx.db.gedComunicacao.findMany({
    where: { usuario_id: ctx.usuario.id, evento: "CONFIRMACAO_WHATSAPP", created_at: { gte: new Date(agora.getTime() - 60 * 60_000) } },
    select: { created_at: true },
  });
  if (recentes.some((r) => agora.getTime() - r.created_at.getTime() < 60_000)) throw invalido("Aguarde um minuto antes de pedir outro código.");
  if (recentes.length >= 5) throw invalido("Muitos pedidos de código na última hora. Tente novamente mais tarde.");

  const mascarado = mascararTelefone(tel);
  await ctx.db.$transaction(async (tx) => {
    const c = await tx.gedComunicacao.create({
      data: {
        usuario_id: ctx.usuario.id, evento: "CONFIRMACAO_WHATSAPP", canal: "WHATSAPP", destinatario_mascarado: mascarado, assunto: "Código de confirmação do WhatsApp", status: "PENDENTE",
      } as Prisma.GedComunicacaoUncheckedCreateInput,
    });
    await tx.gedMembro.update({
      where: { id: m.id },
      data: { telefone_cifrado: cifrar(serializarPendente({ tel, cid: c.id, exp: agora.getTime() + OPTIN_VALIDADE_MS, t: 0 })), whatsapp_optin_em: null },
    });
    await auditarGed(ctx, { acao: "GED_WHATSAPP_CODIGO_SOLICITADO", entidade: "ged_membro", entidade_id: m.id, depois: { telefone: mascarado } }, tx);
  });
  return { telefone_mascarado: mascarado };
}

export async function confirmarCodigoWhatsapp(ctx: CtxGed, codigo: string, agora = new Date()): Promise<void> {
  const m = await membroDoUsuario(ctx);
  const atual = m.telefone_cifrado;
  const pend = lerPendente(decifrar(atual));
  if (!pend || m.whatsapp_optin_em) throw invalido("Não há código aguardando confirmação. Cadastre o telefone para receber um código.");
  const r = conferirCodigoOptin(pend, codigo, ctx.usuario.id, chaveOptinDoServidor(), agora);
  if (r.ok) {
    const n = await ctx.db.$transaction(async (tx) => {
      // só confirma se ninguém alterou o estado desde a leitura (evita corrida entre pedidos paralelos)
      const up = await tx.gedMembro.updateMany({ where: { id: m.id, telefone_cifrado: atual, whatsapp_optin_em: null }, data: { telefone_cifrado: cifrar(pend.tel), whatsapp_optin_em: agora } });
      if (up.count === 1) await auditarGed(ctx, { acao: "GED_WHATSAPP_OPTIN_CONFIRMADO", entidade: "ged_membro", entidade_id: m.id, depois: { telefone: mascararTelefone(pend.tel) } }, tx);
      return up.count;
    });
    if (n !== 1) throw invalido("Não foi possível confirmar agora. Tente novamente.");
    return;
  }
  if (r.motivo === "EXPIRADO") throw invalido("O código expirou. Peça um novo código.");
  if (r.motivo === "TENTATIVAS") throw invalido("Número máximo de tentativas atingido. Peça um novo código.");
  if (r.motivo === "FORMATO") throw invalido("O código tem 6 dígitos.");
  // INCORRETO: conta a tentativa (e só ela) no próprio estado pendente
  await ctx.db.$transaction(async (tx) => {
    const up = await tx.gedMembro.updateMany({ where: { id: m.id, telefone_cifrado: atual, whatsapp_optin_em: null }, data: { telefone_cifrado: cifrar(serializarPendente({ ...pend, t: r.tentativas })) } });
    if (up.count === 1) await auditarGed(ctx, { acao: "GED_WHATSAPP_CODIGO_INCORRETO", entidade: "ged_membro", entidade_id: m.id, depois: { tentativas: r.tentativas } }, tx);
  });
  const restantes = Math.max(0, OPTIN_MAX_TENTATIVAS - r.tentativas);
  throw invalido(restantes > 0 ? `Código incorreto. Restam ${restantes} tentativa(s).` : "Código incorreto. Número máximo de tentativas atingido; peça um novo código.");
}

/** Revoga o opt-in (a qualquer momento): apaga o telefone e cancela envios de WhatsApp ainda pendentes deste usuário. */
export async function revogarWhatsapp(ctx: CtxGed): Promise<void> {
  const m = await membroDoUsuario(ctx);
  await ctx.db.$transaction(async (tx) => {
    await tx.gedMembro.update({ where: { id: m.id }, data: { telefone_cifrado: null, whatsapp_optin_em: null } });
    await tx.gedComunicacao.updateMany({ where: { usuario_id: ctx.usuario.id, canal: "WHATSAPP", status: "PENDENTE" }, data: { status: "IGNORADA", erro: "Opt-in de WhatsApp revogado pelo usuário.", provider_message_id: null } });
    await auditarGed(ctx, { acao: "GED_WHATSAPP_OPTIN_REVOGADO", entidade: "ged_membro", entidade_id: m.id }, tx);
  });
}

/** Telefone confirmado do próprio usuário em E.164 (teste do canal pelo administrador); null se não houver opt-in. */
export async function telefoneConfirmadoDoUsuario(ctx: CtxGed): Promise<string | null> {
  const m = await membroDoUsuario(ctx);
  const c = decifrar(m.telefone_cifrado);
  return m.whatsapp_optin_em && c && !lerPendente(c) ? c : null;
}
