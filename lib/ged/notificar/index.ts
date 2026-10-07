// Notificações do GED (frente E) – ENFILEIRA na caixa de saída (GedComunicacao PENDENTE); quem envia é o job `ged-notificar`
// (lib/ged/notificar/enviar.ts). Roda dentro da transação ESCOPADA do chamador e não envia nada nem verifica permissão.
import type { Prisma } from "@prisma/client";
import { decifrar } from "@/lib/crypto";
import { mascararTelefone } from "@/lib/canais/telefone";
import type { CtxGed, EventoGed, GedTx, NotificarInput } from "../contratos";
import { assuntoEvento } from "../templates";
import {
  chaveDedup, filtrarDestinatarios, JANELA_DEDUP_MS, mascararEmail, planejarCanais, resolverPreferencia, type MembroNotificavel,
} from "./regras";

export type { EventoGed };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Grava as linhas da caixa de saída para cada destinatário e canal habilitado.
 *  - Destinatário: membro ATIVO do GED do MESMO cliente (outros ids são ignorados, sem erro).
 *  - Canais: e-mail (padrão ligado) e WhatsApp (padrão desligado) conforme GedPreferenciaNotificacao; WhatsApp só com telefone
 *    confirmado (opt-in) e canal de envio configurado no cliente; sem isso não há linha WhatsApp (não é erro).
 *  - Deduplica PENDENTES idênticos (usuário + evento + documento + canal) criados há menos de 2 minutos.
 *  - `dados` não é persistido (GedComunicacao não tem coluna para isso): o corpo é remontado no envio a partir do banco.
 */
export async function notificar(tx: GedTx, ctx: CtxGed, evento: EventoGed, input: NotificarInput): Promise<void> {
  const ids = [...new Set(input.usuario_ids)].filter((id) => RE_UUID.test(id));
  if (!ids.length) return;

  let numero: string | null = null;
  if (input.documento_id) {
    const doc = RE_UUID.test(input.documento_id) ? await tx.gedDocumento.findFirst({ where: { id: input.documento_id }, select: { id: true, numero: true } }) : null;
    if (!doc) {
      console.warn(`[ged-notificar] documento ${input.documento_id} não pertence ao cliente; notificação ${evento} ignorada.`);
      return;
    }
    numero = doc.numero;
  }
  if (input.assinante_id) {
    const ass = RE_UUID.test(input.assinante_id) ? await tx.gedAssinante.findFirst({ where: { id: input.assinante_id }, select: { id: true } }) : null;
    if (!ass) {
      console.warn(`[ged-notificar] assinante ${input.assinante_id} não pertence ao cliente; notificação ${evento} ignorada.`);
      return;
    }
  }

  const registros = await tx.gedMembro.findMany({
    where: { usuario_id: { in: ids } },
    select: { usuario_id: true, ativo: true, telefone_cifrado: true, whatsapp_optin_em: true, usuario: { select: { email: true, ativo: true, organizacao_id: true } } },
  });
  const membros: MembroNotificavel[] = registros.map((r) => ({
    usuario_id: r.usuario_id,
    membro_ativo: r.ativo,
    usuario_ativo: r.usuario.ativo,
    usuario_organizacao_id: r.usuario.organizacao_id,
    email: r.usuario.email,
    tem_telefone: !!r.telefone_cifrado,
    whatsapp_optin_em: r.whatsapp_optin_em,
  }));
  const destinatarios = filtrarDestinatarios(ids, membros, ctx.organizacao_id);
  if (!destinatarios.length) return;
  const telefones = new Map(registros.map((r) => [r.usuario_id, r.telefone_cifrado]));
  const emails = new Map(registros.map((r) => [r.usuario_id, r.usuario.email]));

  const [prefs, config, recentes] = await Promise.all([
    tx.gedPreferenciaNotificacao.findMany({ where: { usuario_id: { in: destinatarios.map((d) => d.usuario_id) }, evento }, select: { usuario_id: true, email: true, whatsapp: true } }),
    tx.gedConfig.findFirst({ select: { canal_whatsapp_id: true } }),
    tx.gedComunicacao.findMany({
      where: { usuario_id: { in: destinatarios.map((d) => d.usuario_id) }, evento, documento_id: input.documento_id ?? null, status: "PENDENTE", created_at: { gte: new Date(Date.now() - JANELA_DEDUP_MS) } },
      select: { usuario_id: true, canal: true, documento_id: true },
    }),
  ]);
  const prefPor = new Map(prefs.map((p) => [p.usuario_id, p]));
  const existentes = new Set(recentes.map((r) => chaveDedup(r.usuario_id, evento, r.documento_id, r.canal)));
  const canalWhatsapp = !!config?.canal_whatsapp_id;
  const assunto = assuntoEvento(evento, numero);

  const linhas: Prisma.GedComunicacaoCreateManyInput[] = [];
  for (const d of destinatarios) {
    for (const canal of planejarCanais(d, resolverPreferencia(prefPor.get(d.usuario_id)), canalWhatsapp)) {
      if (existentes.has(chaveDedup(d.usuario_id, evento, input.documento_id, canal))) continue;
      let mascarado: string;
      if (canal === "EMAIL") mascarado = mascararEmail(emails.get(d.usuario_id) ?? "");
      else {
        const tel = decifrar(telefones.get(d.usuario_id));
        mascarado = mascararTelefone(tel);
      }
      linhas.push({
        usuario_id: d.usuario_id, documento_id: input.documento_id ?? null, assinante_id: input.assinante_id ?? null,
        evento, canal, destinatario_mascarado: mascarado, assunto, status: "PENDENTE",
      } as Prisma.GedComunicacaoCreateManyInput);
    }
  }
  if (linhas.length) await tx.gedComunicacao.createMany({ data: linhas });
}
