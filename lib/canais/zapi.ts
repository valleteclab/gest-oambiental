// Z-API (WhatsApp não oficial). Base https://api.z-api.io/instances/{instanceId}/token/{token} + header Client-Token.
// Webhook "Ao receber": URL do canal com ?token=<segredo> (ou header x-webhook-secret) – verificado aqui.
import type { CanalRuntime, InboundEvent, Provedor, TipoEntrada } from "./tipos";
import { baixar, chamarJson, ErroProvedor } from "./http";
import { iguaisSeguro } from "./contato";
import { normalizarTelefone } from "./telefone";

type ZapiIn = {
  type?: string;
  instanceId?: string;
  messageId?: string;
  phone?: string;
  chatName?: string;
  senderName?: string;
  fromMe?: boolean;
  fromApi?: boolean;
  isGroup?: boolean;
  isNewsletter?: boolean;
  momment?: number;
  connected?: boolean;
  text?: { message?: string };
  image?: { imageUrl?: string; caption?: string; mimeType?: string };
  audio?: { audioUrl?: string; mimeType?: string; ptt?: boolean };
  document?: { documentUrl?: string; fileName?: string; mimeType?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; address?: string; name?: string };
  buttonsResponseMessage?: { buttonId?: string; message?: string };
  buttonReply?: { buttonId?: string; message?: string };
  listResponseMessage?: { selectedRowId?: string; title?: string; message?: string };
};

const BASE = "https://api.z-api.io";
const base = (c: CanalRuntime) => {
  if (!c.config.instance_id || !c.segredos.token) throw new ErroProvedor("Informe instanceId e token da Z-API.");
  return `${c.config.base_url || BASE}/instances/${encodeURIComponent(c.config.instance_id)}/token/${encodeURIComponent(c.segredos.token)}`;
};
const cab = (c: CanalRuntime): Record<string, string> => (c.segredos.client_token ? { "Client-Token": c.segredos.client_token } : {});

/** Normaliza o callback "Ao receber" da Z-API. Exportado para testes. */
export function normalizarZapi(corpo: unknown, canal: Pick<CanalRuntime, "id">): InboundEvent[] {
  const b = corpo as ZapiIn;
  if (!b || b.type !== "ReceivedCallback" || !b.messageId || !b.phone) return [];
  const isGroup = !!b.isGroup || !!b.isNewsletter || b.phone.includes("-group") || b.phone.endsWith("@g.us");
  let kind: TipoEntrada = "unknown";
  let text: string | null = null;
  let buttonId: string | null = null;
  let location: InboundEvent["location"] = null;
  let url: string | null = null;
  let mime: string | null = null;
  let nome: string | null = null;
  const botao = b.buttonsResponseMessage ?? b.buttonReply;
  if (botao?.buttonId || b.listResponseMessage?.selectedRowId) {
    kind = "button";
    buttonId = botao?.buttonId ?? b.listResponseMessage?.selectedRowId ?? null;
    text = botao?.message ?? b.listResponseMessage?.title ?? null;
  } else if (b.text?.message) {
    kind = "text";
    text = b.text.message;
  } else if (b.image?.imageUrl) {
    kind = "image";
    text = b.image.caption ?? null;
    url = b.image.imageUrl;
    mime = b.image.mimeType ?? "image/jpeg";
  } else if (b.audio?.audioUrl) {
    kind = "audio";
    url = b.audio.audioUrl;
    mime = b.audio.mimeType ?? "audio/ogg";
  } else if (b.document?.documentUrl) {
    kind = "document";
    url = b.document.documentUrl;
    mime = b.document.mimeType ?? null;
    nome = b.document.fileName ?? null;
    text = b.document.caption ?? null;
  } else if (b.location && typeof b.location.latitude === "number" && typeof b.location.longitude === "number") {
    kind = "location";
    location = { lat: b.location.latitude, lng: b.location.longitude, endereco: [b.location.name, b.location.address].filter(Boolean).join(" – ") || null };
  }
  const urlMidia = url;
  return [{
    channelId: canal.id,
    providerMessageId: b.messageId,
    chatId: b.phone,
    replyTarget: b.phone,
    from: { phoneE164: isGroup ? null : normalizarTelefone(b.phone), name: b.fromMe ? null : b.senderName ?? b.chatName ?? null },
    isGroup,
    fromMe: !!b.fromMe,
    sentByApi: !!b.fromMe && !!b.fromApi,
    kind,
    text,
    buttonId,
    location,
    // URLs de mídia da Z-API expiram: o processamento baixa imediatamente para o storage.
    media: urlMidia ? { mime, nome, fetch: async () => { const r = await baixar(urlMidia); return { ...r, mime: mime ?? r.mime, nome }; } } : null,
    timestamp: b.momment ? new Date(b.momment) : new Date(),
  }];
}

export const zapi: Provedor = {
  tipo: "WHATSAPP_ZAPI",
  oficial: () => false,
  limitarRitmo: true,
  verifyWebhook(req, canal) {
    const t = req.headers.get("x-webhook-secret") ?? req.headers.get("z-api-token") ?? req.url.searchParams.get("token");
    return iguaisSeguro(t, canal.webhookSecret);
  },
  parseWebhook(corpo, _ct, canal) {
    return normalizarZapi(JSON.parse(corpo), canal);
  },
  parseStatusConexao(corpo) {
    const b = JSON.parse(corpo) as ZapiIn;
    if (b.type === "ConnectedCallback") return "open";
    if (b.type === "DisconnectedCallback") return "close";
    return null;
  },
  async sendText(canal, destino, texto) {
    const r = await chamarJson<{ messageId?: string; id?: string }>(`${base(canal)}/send-text`, { headers: cab(canal), json: { phone: destino, message: texto, delayTyping: 2 } });
    return { providerMessageId: r.messageId ?? r.id ?? null };
  },
  async sendMedia(canal, destino, midia) {
    const dataUri = `data:${midia.mime};base64,${midia.dados.toString("base64")}`;
    const rota = midia.mime.startsWith("image/") ? "send-image" : "send-document/pdf";
    const corpo = midia.mime.startsWith("image/") ? { phone: destino, image: dataUri, caption: midia.legenda ?? "" } : { phone: destino, document: dataUri, fileName: midia.nome };
    const r = await chamarJson<{ messageId?: string }>(`${base(canal)}/${rota}`, { headers: cab(canal), json: corpo });
    return { providerMessageId: r.messageId ?? null };
  },
  async sendButtons(canal, destino, texto, botoes) {
    const r = await chamarJson<{ messageId?: string }>(`${base(canal)}/send-button-actions`, {
      headers: cab(canal),
      json: { phone: destino, message: texto, buttonActions: botoes.slice(0, 3).map((b) => ({ id: b.id, type: "REPLY", label: b.rotulo.slice(0, 20) })) },
    });
    return { providerMessageId: r.messageId ?? null };
  },
  async connect(canal) {
    const st = await this.status!(canal);
    if (st.estado === "open") return { estado: "open", mensagem: "Instância já conectada." };
    const qr = await chamarJson<{ value?: string }>(`${base(canal)}/qr-code/image`, { headers: cab(canal) });
    return { estado: st.estado, qrcode: qr.value ?? null };
  },
  async status(canal) {
    const r = await chamarJson<{ connected?: boolean; error?: string; smartphoneConnected?: boolean }>(`${base(canal)}/status`, { headers: cab(canal) });
    return { estado: r.connected ? "open" : "close", detalhe: r.error };
  },
};
