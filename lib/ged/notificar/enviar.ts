// Envio da caixa de saída do GED (GedComunicacao PENDENTE → ENVIADA/SIMULADA/ERRO/IGNORADA). Chamado pelo job `ged-notificar`
// (jobs/ged-notificar.ts), um registro por vez, SEMPRE com `gedDb(organizacao_id)`: nada aqui enxerga outro cliente.
//
//  - Reserva atômica (updateMany PENDENTE → "reserva:<token>" em provider_message_id): dois workers nunca enviam a mesma linha.
//    Reserva abandonada (worker caiu) é retomada após 5 minutos (entrega "pelo menos uma vez").
//  - Falha transitória → volta a PENDENTE com "[tN] motivo" em `erro` e espera crescente; após 3 tentativas vira ERRO.
//  - Data/hora do e-mail/WhatsApp = relógio no ENVIO (parâmetro `agora`), não o da criação da linha.
import { randomUUID } from "node:crypto";
import type { GedStatusCom } from "@prisma/client";
import { decifrar } from "@/lib/crypto";
import { enviarEmail } from "@/lib/email";
import { comRitmo, envioSimulado, montarRuntime, provedor, urlBase } from "@/lib/canais";
import { gedDb, type GedDb } from "../db";
import { enviarAvisoProtocolo } from "../protocolo/aviso";
import { renderEmail, renderWhatsapp, type ContextoTemplate } from "../templates";
import {
  chaveOptinDoServidor, codigoOptin, erroComTentativa, esperaTentativaMs, lerPendente, MAX_TENTATIVAS_ENVIO, PREFIXO_RESERVA, RESERVA_EXPIRA_MS, tentativasDoErro,
  type EventoNotificacao,
} from "./regras";

export type ResultadoProcessamento = GedStatusCom | "REAGENDADA" | "ADIADA" | "OCUPADA" | "INEXISTENTE";

type Desfecho = { status: GedStatusCom; erro?: string | null; provider_message_id?: string | null; email_enviado_id?: string | null; transitorio?: boolean };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);
const TIPOS_WHATSAPP = new Set(["WHATSAPP_EVOLUTION", "WHATSAPP_ZAPI", "WHATSAPP_CHATWOOT"]);

type Linha = NonNullable<Awaited<ReturnType<GedDb["gedComunicacao"]["findUnique"]>>>;

/** Processa UMA comunicação da caixa de saída. Nunca lança por falha de envio (vira estado da linha). */
export async function processarComunicacao(organizacaoId: string, id: string, opc: { agora?: () => Date } = {}): Promise<ResultadoProcessamento> {
  const db = gedDb(organizacaoId);
  const agora = opc.agora ?? (() => new Date());
  const linha = await db.gedComunicacao.findUnique({ where: { id } }).catch(() => null);
  if (!linha) return "INEXISTENTE";
  if (linha.status !== "PENDENTE") return "OCUPADA";

  const tentativa = tentativasDoErro(linha.erro);
  const espera = esperaTentativaMs(tentativa);
  const limiteReserva = new Date(agora().getTime() - RESERVA_EXPIRA_MS);
  if (espera > 0 && linha.updated_at.getTime() > agora().getTime() - espera) return "ADIADA";

  const token = `${PREFIXO_RESERVA}${randomUUID()}`;
  const reservou = await db.gedComunicacao.updateMany({
    where: {
      id, status: "PENDENTE", updated_at: { lte: new Date(agora().getTime() - espera) },
      OR: [{ provider_message_id: null }, { provider_message_id: { startsWith: PREFIXO_RESERVA }, updated_at: { lt: limiteReserva } }],
    },
    data: { provider_message_id: token },
  });
  if (reservou.count !== 1) return "OCUPADA";

  let d: Desfecho;
  try {
    d = await enviar(db, organizacaoId, linha, agora());
  } catch (e) {
    d = { status: "ERRO", erro: msg(e), transitorio: true };
  }

  if (d.status === "ERRO" && d.transitorio && tentativa + 1 < MAX_TENTATIVAS_ENVIO) {
    await db.gedComunicacao.update({ where: { id }, data: { status: "PENDENTE", erro: erroComTentativa(tentativa + 1, d.erro ?? "falha no envio"), provider_message_id: null } });
    return "REAGENDADA";
  }
  const ok = d.status === "ENVIADA" || d.status === "SIMULADA";
  await db.gedComunicacao.update({
    where: { id },
    data: {
      status: d.status,
      erro: d.erro ? d.erro.slice(0, 500) : null,
      provider_message_id: d.provider_message_id ?? null,
      email_enviado_id: d.email_enviado_id ?? null,
      enviado_em: ok ? agora() : null,
    },
  });
  return d.status;
}

async function enviar(db: GedDb, organizacaoId: string, linha: Linha, agora: Date): Promise<Desfecho> {
  // Comunicação ao interessado externo de um protocolo (sem usuário interno): lib/ged/protocolo/aviso.ts
  if (linha.protocolo_id) return enviarAvisoProtocolo(db, organizacaoId, linha, agora);
  if (!linha.usuario_id) return { status: "IGNORADA", erro: "Comunicação sem destinatário." };
  const membro = await db.gedMembro.findFirst({
    where: { usuario_id: linha.usuario_id },
    select: { ativo: true, telefone_cifrado: true, whatsapp_optin_em: true, usuario: { select: { nome: true, email: true, ativo: true, organizacao_id: true } } },
  });
  if (!membro || !membro.ativo || !membro.usuario.ativo || membro.usuario.organizacao_id !== organizacaoId) {
    return { status: "IGNORADA", erro: "Destinatário não é mais membro ativo do módulo." };
  }
  const org = await db.organizacao.findUnique({ where: { id: organizacaoId }, select: { nome: true } });
  const doc = linha.documento_id
    ? await db.gedDocumento.findFirst({ where: { id: linha.documento_id }, select: { id: true, numero: true, titulo: true, sensibilidade: true } })
    : null;
  const evento = linha.evento as EventoNotificacao;

  const extra = await detalhes(db, organizacaoId, linha, evento);
  const base: ContextoTemplate = {
    evento, organizacao_nome: org?.nome ?? "", destinatario_nome: membro.usuario.nome, documento: doc, remetente_nome: extra.remetente, prazo_em: extra.prazo, app_url: urlBase(), agora,
  };

  if (linha.canal === "EMAIL") {
    if (!membro.usuario.email) return { status: "IGNORADA", erro: "Destinatário sem e-mail cadastrado." };
    const r = renderEmail(base);
    const reg = await enviarEmail(membro.usuario.email, r.assunto, r.html);
    if (!process.env.SMTP_URL) return { status: "SIMULADA", email_enviado_id: reg.id, erro: null }; // caixa de teste (/admin/emails)
    const fim = await db.emailEnviado.findUnique({ where: { id: reg.id }, select: { enviado: true, erro: true } });
    if (fim?.enviado) return { status: "ENVIADA", email_enviado_id: reg.id };
    return { status: "ERRO", email_enviado_id: reg.id, erro: (fim?.erro ?? "Falha no envio do e-mail.").slice(0, 300), transitorio: true };
  }

  // ── WhatsApp ──
  const config = await db.gedConfig.findFirst({ select: { canal_whatsapp_id: true } });
  if (!config?.canal_whatsapp_id) return { status: "IGNORADA", erro: "Nenhum canal de WhatsApp configurado para o cliente." };
  const canalDb = await db.canalAtendimento.findFirst({ where: { id: config.canal_whatsapp_id, organizacao_id: organizacaoId, ativo: true } });
  if (!canalDb || !TIPOS_WHATSAPP.has(canalDb.tipo)) return { status: "ERRO", erro: "Canal de WhatsApp do cliente inexistente, inativo ou inválido." };
  const canal = montarRuntime(canalDb);

  let telefone: string | null;
  let codigo: string | null = null;
  if (evento === "CONFIRMACAO_WHATSAPP") {
    const pend = lerPendente(decifrar(membro.telefone_cifrado));
    if (!pend || pend.cid !== linha.id) return { status: "IGNORADA", erro: "Código substituído por um pedido mais recente (ou já confirmado)." };
    telefone = pend.tel;
    codigo = codigoOptin(chaveOptinDoServidor(), linha.id, linha.usuario_id, pend.tel);
  } else {
    if (!membro.whatsapp_optin_em) return { status: "IGNORADA", erro: "Telefone sem confirmação (opt-in) ou opt-in revogado." };
    telefone = decifrar(membro.telefone_cifrado);
    if (lerPendente(telefone)) return { status: "IGNORADA", erro: "Telefone aguardando nova confirmação." };
  }
  if (!telefone) return { status: "IGNORADA", erro: "Destinatário sem telefone cadastrado." };

  const prov = provedor(canal.tipo);
  // Canal oficial (Chatwoot/Cloud API): sem conversa aberta pelo próprio usuário, fora da janela de 24 h só vale template aprovado.
  if (prov.oficial(canal)) return { status: "IGNORADA", erro: "API oficial do WhatsApp: fora da janela de 24 h é necessário template aprovado (fase 1 usa Evolution/Z-API)." };
  const texto = renderWhatsapp({ ...base, codigo });
  if (envioSimulado()) {
    console.log(`[ged-notificar][simulado] WhatsApp ${linha.evento} → ${linha.destinatario_mascarado}: ${texto.slice(0, 120).replace(/\n/g, " ⏎ ")}`);
    return { status: "SIMULADA" };
  }
  try {
    const r = await comRitmo(canal, () => prov.sendText(canal, telefone, texto));
    return { status: "ENVIADA", provider_message_id: r.providerMessageId ?? null };
  } catch (e) {
    return { status: "ERRO", erro: msg(e), transitorio: true };
  }
}

/** Dados que não cabem na linha da caixa de saída são buscados no envio (remetente do trâmite, prazo da solicitação). */
async function detalhes(db: GedDb, organizacaoId: string, linha: Linha, evento: EventoNotificacao): Promise<{ remetente: string | null; prazo: Date | null }> {
  let remetenteId: string | null = null;
  let prazo: Date | null = null;
  try {
    if (evento === "TRAMITE_RECEBIDO" && linha.documento_id) {
      const t = await db.gedTramite.findFirst({ where: { documento_id: linha.documento_id, para_usuario_id: linha.usuario_id }, orderBy: { created_at: "desc" }, select: { de_usuario_id: true } });
      remetenteId = t?.de_usuario_id ?? null;
    } else if ((evento === "ASSINATURA_SOLICITADA" || evento === "ASSINATURA_LEMBRETE") && linha.assinante_id) {
      const a = await db.gedAssinante.findFirst({ where: { id: linha.assinante_id }, select: { solicitacao: { select: { prazo_em: true, criada_por_id: true } } } });
      prazo = a?.solicitacao.prazo_em ?? null;
      remetenteId = evento === "ASSINATURA_SOLICITADA" ? a?.solicitacao.criada_por_id ?? null : null;
    }
    if (!remetenteId) return { remetente: null, prazo };
    const u = await db.usuario.findFirst({ where: { id: remetenteId, organizacao_id: organizacaoId }, select: { nome: true } });
    return { remetente: u?.nome ?? null, prazo };
  } catch {
    return { remetente: null, prazo };
  }
}
