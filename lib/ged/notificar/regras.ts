// Regras PURAS das notificações do GED (sem banco/rede): eventos, preferências, planejamento de canais, deduplicação,
// máscaras e código de confirmação do WhatsApp (opt-in). Testadas em tests/unit/ged-notificar.test.ts.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GedCanalCom } from "@prisma/client";
import type { EventoGed } from "../contratos";

/** Eventos do contrato + eventos internos do módulo (não aparecem nas preferências). */
export type EventoNotificacao = EventoGed | "CONFIRMACAO_WHATSAPP";

/** Eventos que o usuário pode ligar/desligar por canal em "Minhas notificações". */
export const EVENTOS_CONFIGURAVEIS: readonly EventoGed[] = [
  "TRAMITE_RECEBIDO",
  "ASSINATURA_SOLICITADA",
  "ASSINATURA_CONCLUIDA",
  "ASSINATURA_RECUSADA",
  "ASSINATURA_LEMBRETE",
  "ASSINATURA_EXPIRADA",
  "ASSINATURA_CANCELADA",
  "DOCUMENTO_COMPARTILHADO",
];

export const ROTULO_EVENTO: Record<EventoNotificacao, string> = {
  TRAMITE_RECEBIDO: "Documento recebido em trâmite",
  ASSINATURA_SOLICITADA: "Assinatura solicitada a você",
  ASSINATURA_CONCLUIDA: "Assinatura concluída",
  ASSINATURA_RECUSADA: "Assinatura recusada",
  ASSINATURA_LEMBRETE: "Lembrete de assinatura pendente",
  ASSINATURA_EXPIRADA: "Solicitação de assinatura expirada",
  ASSINATURA_CANCELADA: "Solicitação de assinatura cancelada",
  DOCUMENTO_COMPARTILHADO: "Documento compartilhado com você",
  CONFIRMACAO_WHATSAPP: "Código de confirmação do WhatsApp",
};

export const ehEventoConfiguravel = (e: string): e is EventoGed => (EVENTOS_CONFIGURAVEIS as readonly string[]).includes(e);

// ───────────── Preferências ─────────────

export type PreferenciaCanais = { email: boolean; whatsapp: boolean };
/** Padrão sem registro: e-mail ligado, WhatsApp desligado. */
export const PREFERENCIA_PADRAO: Readonly<PreferenciaCanais> = { email: true, whatsapp: false };

export function resolverPreferencia(registro: Partial<PreferenciaCanais> | null | undefined): PreferenciaCanais {
  return { email: registro?.email ?? PREFERENCIA_PADRAO.email, whatsapp: registro?.whatsapp ?? PREFERENCIA_PADRAO.whatsapp };
}

// ───────────── Planejamento de canais ─────────────

export type MembroNotificavel = {
  usuario_id: string;
  membro_ativo: boolean;
  usuario_ativo: boolean;
  /** organizacao_id do Usuario (deve ser a do tenant). */
  usuario_organizacao_id: string | null;
  email: string | null;
  tem_telefone: boolean;
  whatsapp_optin_em: Date | null;
};

/** Destinatários válidos: membros ATIVOS do MESMO cliente, na ordem pedida, sem repetição. Demais ids são ignorados. */
export function filtrarDestinatarios(usuarioIds: readonly string[], membros: readonly MembroNotificavel[], organizacaoId: string): MembroNotificavel[] {
  const por = new Map(membros.map((m) => [m.usuario_id, m]));
  const vistos = new Set<string>();
  const out: MembroNotificavel[] = [];
  for (const id of usuarioIds) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    const m = por.get(id);
    if (m && m.membro_ativo && m.usuario_ativo && m.usuario_organizacao_id === organizacaoId) out.push(m);
  }
  return out;
}

/**
 * Canais a gravar para um destinatário. E-mail: preferência ligada e e-mail cadastrado.
 * WhatsApp: preferência ligada E telefone E opt-in confirmado E canal configurado no cliente (senão simplesmente não há linha).
 */
export function planejarCanais(m: Pick<MembroNotificavel, "email" | "tem_telefone" | "whatsapp_optin_em">, pref: PreferenciaCanais, canalWhatsappConfigurado: boolean): GedCanalCom[] {
  const canais: GedCanalCom[] = [];
  if (pref.email && m.email) canais.push("EMAIL");
  if (pref.whatsapp && m.tem_telefone && m.whatsapp_optin_em && canalWhatsappConfigurado) canais.push("WHATSAPP");
  return canais;
}

// ───────────── Deduplicação ─────────────

/** Janela em que um PENDENTE idêntico (usuário + evento + documento + canal) impede outro igual. */
export const JANELA_DEDUP_MS = 2 * 60 * 1000;

export const chaveDedup = (usuarioId: string, evento: string, documentoId: string | null | undefined, canal: GedCanalCom) => `${usuarioId}|${evento}|${documentoId ?? "-"}|${canal}`;

// ───────────── Máscaras ─────────────

/** "maria.silva@camara.gov.br" → "m***@camara.gov.br". */
export function mascararEmail(email: string): string {
  const i = email.lastIndexOf("@");
  if (i <= 0) return "***";
  return `${email[0]}***${email.slice(i)}`;
}

// ───────────── Tentativas e retentativa (outbox) ─────────────

export const MAX_TENTATIVAS_ENVIO = 3;
/** Espera mínima antes da tentativa N (1ª = imediata). */
export const esperaTentativaMs = (tentativa: number): number => (tentativa <= 0 ? 0 : Math.min(15 * 60_000, 30_000 * 2 ** (tentativa - 1)));
const RE_TENTATIVA = /^\[t(\d+)\]\s*/;
/** O número de tentativas já feitas é guardado no prefixo "[tN] " de `erro` enquanto a linha está PENDENTE. */
export function tentativasDoErro(erro: string | null | undefined): number {
  const m = RE_TENTATIVA.exec(erro ?? "");
  return m ? Number(m[1]) : 0;
}
export const erroComTentativa = (tentativa: number, msg: string) => `[t${tentativa}] ${msg}`.slice(0, 500);
export const semPrefixoTentativa = (erro: string | null | undefined) => (erro ?? "").replace(RE_TENTATIVA, "");

/** Marcador de "linha reservada por um sender" em provider_message_id (enquanto PENDENTE). */
export const PREFIXO_RESERVA = "reserva:";
export const RESERVA_EXPIRA_MS = 5 * 60 * 1000;

// ───────────── Confirmação do WhatsApp (opt-in) ─────────────
//
// O estado "aguardando confirmação" fica no próprio GedMembro.telefone_cifrado (cifrado) enquanto `whatsapp_optin_em` é nulo:
//   { tel, cid, exp, t }  → telefone E.164, id da comunicação que levou o código, expiração (ms) e tentativas erradas.
// O código de 6 dígitos NUNCA é guardado: é derivado por HMAC(chave do servidor, cid|usuário|telefone) – só quem tem a chave
// (o servidor) o reproduz, para montar a mensagem (job) e para conferir. Um novo pedido gera outro `cid` e invalida o anterior.

export const OPTIN_VALIDADE_MS = 10 * 60 * 1000;
export const OPTIN_MAX_TENTATIVAS = 5;

export type OptinPendente = { tel: string; cid: string; exp: number; t: number };

export function serializarPendente(p: OptinPendente): string {
  return JSON.stringify({ tel: p.tel, cid: p.cid, exp: p.exp, t: p.t });
}

/** Lê o conteúdo decifrado de telefone_cifrado: JSON de pendência ou null (telefone simples já confirmado). */
export function lerPendente(conteudo: string | null | undefined): OptinPendente | null {
  if (!conteudo || !conteudo.startsWith("{")) return null;
  try {
    const o = JSON.parse(conteudo) as Partial<OptinPendente>;
    if (typeof o.tel === "string" && typeof o.cid === "string" && typeof o.exp === "number" && typeof o.t === "number") return { tel: o.tel, cid: o.cid, exp: o.exp, t: o.t };
  } catch {
    /* não é pendência */
  }
  return null;
}

export function codigoOptin(chave: string | Buffer, cid: string, usuarioId: string, telefone: string): string {
  const h = createHmac("sha256", chave).update(`ged-optin|${cid}|${usuarioId}|${telefone}`).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export type ResultadoConfirmacao = { ok: true } | { ok: false; motivo: "EXPIRADO" | "TENTATIVAS" | "INCORRETO" | "FORMATO"; tentativas: number };

export function conferirCodigoOptin(p: OptinPendente, informado: string, usuarioId: string, chave: string | Buffer, agora = new Date()): ResultadoConfirmacao {
  if (agora.getTime() > p.exp) return { ok: false, motivo: "EXPIRADO", tentativas: p.t };
  if (p.t >= OPTIN_MAX_TENTATIVAS) return { ok: false, motivo: "TENTATIVAS", tentativas: p.t };
  const digitos = informado.replace(/\D/g, "");
  if (digitos.length !== 6) return { ok: false, motivo: "FORMATO", tentativas: p.t };
  const esperado = Buffer.from(codigoOptin(chave, p.cid, usuarioId, p.tel));
  const recebido = Buffer.from(digitos);
  if (esperado.length === recebido.length && timingSafeEqual(esperado, recebido)) return { ok: true };
  return { ok: false, motivo: "INCORRETO", tentativas: p.t + 1 };
}

/** Chave HMAC derivada da DATA_KEY do servidor (separada da chave de cifragem). */
export function chaveOptinDoServidor(): Buffer {
  const hex = process.env.DATA_KEY;
  if (!hex || hex.length !== 64) throw new Error("DATA_KEY ausente ou inválida (64 hex)");
  return createHmac("sha256", Buffer.from(hex, "hex")).update("ged-optin-v1").digest();
}
