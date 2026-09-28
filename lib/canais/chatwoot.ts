// Chatwoot (caixa WhatsApp Cloud API oficial por trás). Envio: POST {url}/api/v1/accounts/{conta}/conversations/{conv}/messages
// com header api_access_token. Mensagens da IA começam com MARCA_IA (espaço de largura zero) para distingui-las dos
// atendentes humanos no eco do webhook. Verificação: HMAC (X-Chatwoot-Signature) se configurado, senão ?token= na URL.
import { createHmac } from "node:crypto";
import type { CanalRuntime, InboundEvent, Provedor, TipoEntrada } from "./tipos";
import { baixar, chamarJson, ErroProvedor, semBarraFinal } from "./http";
import { iguaisSeguro } from "./contato";
import { normalizarTelefone } from "./telefone";

export const MARCA_IA = "​";

type Anexo = { file_type?: string; data_url?: string; coordinates_lat?: number; coordinates_long?: number; fallback_title?: string };
type CwIn = {
  event?: string;
  message_type?: string | number;
  id?: number | string;
  content?: string | null;
  private?: boolean;
  created_at?: string | number;
  content_attributes?: { submitted_values?: { value?: string }[] };
  sender?: { id?: number; name?: string; phone_number?: string; email?: string; type?: string };
  conversation?: { id?: number | string; inbox_id?: number | string; meta?: { sender?: { phone_number?: string; name?: string } } };
  inbox?: { id?: number | string };
  attachments?: Anexo[];
};

const tipoMsg = (t: CwIn["message_type"]) => (t === 0 || t === "incoming" ? "incoming" : t === 1 || t === "outgoing" ? "outgoing" : String(t ?? ""));

/** Normaliza `message_created` do Chatwoot. Exportado para testes. */
export function normalizarChatwoot(corpo: unknown, canal: Pick<CanalRuntime, "id" | "config" | "segredos">): InboundEvent[] {
  const b = corpo as CwIn;
  if (!b || b.event !== "message_created" || b.private) return [];
  const tipo = tipoMsg(b.message_type);
  if (tipo !== "incoming" && tipo !== "outgoing") return [];
  const convId = b.conversation?.id;
  if (convId === undefined || b.id === undefined) return [];
  const inbox = b.conversation?.inbox_id ?? b.inbox?.id;
  if (canal.config.inbox_id && inbox !== undefined && String(inbox) !== String(canal.config.inbox_id)) return [];
  const conteudo = b.content ?? "";
  const daIa = conteudo.startsWith(MARCA_IA);
  const fromMe = tipo === "outgoing";
  const a = b.attachments?.[0];
  let kind: TipoEntrada = conteudo ? "text" : "unknown";
  let location: InboundEvent["location"] = null;
  let url: string | null = null;
  if (a?.file_type === "location" && typeof a.coordinates_lat === "number" && typeof a.coordinates_long === "number") {
    kind = "location";
    location = { lat: a.coordinates_lat, lng: a.coordinates_long, endereco: a.fallback_title ?? null };
  } else if (a?.data_url && (a.file_type === "image" || a.file_type === "audio" || a.file_type === "file")) {
    kind = a.file_type === "image" ? "image" : a.file_type === "audio" ? "audio" : "document";
    url = a.data_url;
  }
  const botao = b.content_attributes?.submitted_values?.[0]?.value ?? null;
  const telefone = fromMe ? b.conversation?.meta?.sender?.phone_number : b.sender?.phone_number ?? b.conversation?.meta?.sender?.phone_number;
  const urlMidia = url;
  const token = canal.segredos.api_token;
  const ts = typeof b.created_at === "number" ? new Date(b.created_at * 1000) : b.created_at ? new Date(b.created_at) : new Date();
  return [{
    channelId: canal.id,
    providerMessageId: String(b.id),
    chatId: String(convId),
    replyTarget: String(convId),
    from: { phoneE164: normalizarTelefone(telefone), email: fromMe ? null : b.sender?.email ?? null, name: fromMe ? null : b.sender?.name ?? b.conversation?.meta?.sender?.name ?? null },
    isGroup: false,
    fromMe,
    sentByApi: fromMe && daIa,
    kind: botao ? "button" : kind,
    text: daIa ? conteudo.slice(MARCA_IA.length) : conteudo || null,
    buttonId: botao,
    location,
    media: urlMidia ? { mime: null, nome: null, fetch: async () => baixar(urlMidia, token ? { api_access_token: token } : {}) } : null,
    timestamp: isNaN(ts.getTime()) ? new Date() : ts,
  }];
}

const urlBase = (c: CanalRuntime) => {
  if (!c.config.url || !c.config.account_id || !c.segredos.api_token) throw new ErroProvedor("Informe URL, conta e token de acesso do Chatwoot.");
  return `${semBarraFinal(c.config.url)}/api/v1/accounts/${encodeURIComponent(c.config.account_id)}`;
};

export const chatwoot: Provedor = {
  tipo: "WHATSAPP_CHATWOOT",
  // Caixa WhatsApp Cloud (oficial): fora da janela de 24 h só template aprovado. Configurável (ex.: caixa de site).
  oficial: (c) => c.config.janela_24h !== "false",
  limitarRitmo: false,
  verifyWebhook(req, canal) {
    const assinatura = req.headers.get("x-chatwoot-signature");
    const segredo = canal.segredos.hmac_secret;
    if (assinatura && segredo) {
      const ts = req.headers.get("x-chatwoot-timestamp");
      const recebida = assinatura.replace(/^sha256=/, "");
      const candidatos = [createHmac("sha256", segredo).update(req.corpo).digest("hex")];
      if (ts) candidatos.push(createHmac("sha256", segredo).update(`${ts}.${req.corpo}`).digest("hex"));
      if (candidatos.some((c) => iguaisSeguro(c, recebida))) return true;
    }
    return iguaisSeguro(req.url.searchParams.get("token") ?? req.headers.get("x-webhook-secret"), canal.webhookSecret);
  },
  parseWebhook(corpo, _ct, canal) {
    return normalizarChatwoot(JSON.parse(corpo), canal);
  },
  async sendText(canal, destino, texto) {
    const r = await chamarJson<{ id?: number }>(`${urlBase(canal)}/conversations/${encodeURIComponent(destino)}/messages`, {
      headers: { api_access_token: canal.segredos.api_token },
      json: { content: `${MARCA_IA}${texto}`, message_type: "outgoing", private: false },
    });
    return { providerMessageId: r.id !== undefined ? String(r.id) : null };
  },
  async sendMedia(canal, destino, midia) {
    const fd = new FormData();
    fd.append("content", `${MARCA_IA}${midia.legenda ?? ""}`);
    fd.append("message_type", "outgoing");
    fd.append("private", "false");
    fd.append("attachments[]", new Blob([new Uint8Array(midia.dados)], { type: midia.mime }), midia.nome);
    const r = await chamarJson<{ id?: number }>(`${urlBase(canal)}/conversations/${encodeURIComponent(destino)}/messages`, { headers: { api_access_token: canal.segredos.api_token }, body: fd });
    return { providerMessageId: r.id !== undefined ? String(r.id) : null };
  },
  async status(canal) {
    await chamarJson(`${urlBase(canal)}/inboxes`, { headers: { api_access_token: canal.segredos.api_token } });
    return { estado: "open", detalhe: "Token do Chatwoot válido." };
  },
};
