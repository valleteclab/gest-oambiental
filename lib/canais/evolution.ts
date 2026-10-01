// Evolution API v2 (Baileys – WhatsApp não oficial). Base: EVOLUTION_BASE_URL (ou config.base_url), header apikey.
// Webhook: POST /webhook/set/{instância} com header x-webhook-secret (verificado aqui).
import type { CanalRuntime, InboundEvent, Provedor, RequisicaoWebhook, TipoEntrada } from "./tipos";
import { chamarJson, ErroProvedor, semBarraFinal } from "./http";
import { iguaisSeguro } from "./contato";
import { normalizarTelefone } from "./telefone";

type ChaveEvo = { remoteJid?: string; fromMe?: boolean; id?: string; remoteJidAlt?: string; senderPn?: string; participant?: string };
type MsgEvo = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string; mimetype?: string; url?: string };
  audioMessage?: { ptt?: boolean; mimetype?: string };
  documentMessage?: { fileName?: string; mimetype?: string; caption?: string; title?: string };
  documentWithCaptionMessage?: { message?: { documentMessage?: { fileName?: string; mimetype?: string; caption?: string } } };
  locationMessage?: { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string };
  liveLocationMessage?: { degreesLatitude?: number; degreesLongitude?: number };
  buttonsResponseMessage?: { selectedButtonId?: string; selectedDisplayText?: string };
  templateButtonReplyMessage?: { selectedId?: string; selectedDisplayText?: string };
  listResponseMessage?: { title?: string; singleSelectReply?: { selectedRowId?: string } };
  base64?: string;
};
type DadosEvo = { key?: ChaveEvo; pushName?: string; messageTimestamp?: number | string; message?: MsgEvo; messageType?: string; source?: string; status?: string };

export const baseEvolution = (c: CanalRuntime) => semBarraFinal(c.config.base_url || process.env.EVOLUTION_BASE_URL || "");
const chaveApi = (c: CanalRuntime) => c.segredos.api_key || process.env.EVOLUTION_API_KEY || "";
const instancia = (c: CanalRuntime) => encodeURIComponent(c.config.instance_name || "");

function exigirConfig(c: CanalRuntime) {
  if (!baseEvolution(c)) throw new ErroProvedor("EVOLUTION_BASE_URL não configurada.");
  if (!chaveApi(c)) throw new ErroProvedor("EVOLUTION_API_KEY não configurada.");
  if (!c.config.instance_name) throw new ErroProvedor("Informe o nome da instância.");
}

async function api<T = unknown>(c: CanalRuntime, caminho: string, json?: unknown, method?: string) {
  exigirConfig(c);
  return chamarJson<T>(`${baseEvolution(c)}${caminho}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers: { apikey: chaveApi(c) }, json });
}

/** Normaliza um payload `messages.upsert` (objeto único ou lista). Exportado para testes. */
export function normalizarEvolution(corpo: unknown, canal: Pick<CanalRuntime, "id" | "config" | "segredos"> & Partial<CanalRuntime>): InboundEvent[] {
  const b = corpo as { event?: string; instance?: string; data?: DadosEvo | DadosEvo[] | { messages?: DadosEvo[] } };
  const ev = String(b?.event ?? "").toLowerCase().replace(/_/g, ".");
  if (ev !== "messages.upsert") return [];
  const lista: DadosEvo[] = Array.isArray(b.data) ? b.data : b.data && "messages" in b.data && Array.isArray(b.data.messages) ? b.data.messages : b.data ? [b.data as DadosEvo] : [];
  const out: InboundEvent[] = [];
  for (const d of lista) {
    const k = d.key ?? {};
    const jid = k.remoteJid ?? "";
    if (!k.id || !jid) continue;
    const isGroup = jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid === "status@broadcast";
    // @lid não é telefone: usa remoteJidAlt/senderPn quando vierem
    const jidTelefone = jid.endsWith("@lid") ? k.remoteJidAlt || k.senderPn || null : jid;
    const phone = jidTelefone ? normalizarTelefone(jidTelefone) : null;
    const m = d.message ?? {};
    const doc = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
    let kind: TipoEntrada = "unknown";
    let text: string | null = null;
    let buttonId: string | null = null;
    let location: InboundEvent["location"] = null;
    let mime: string | null = null;
    let nome: string | null = null;
    if (m.conversation || m.extendedTextMessage?.text) {
      kind = "text";
      text = m.conversation ?? m.extendedTextMessage?.text ?? null;
    } else if (m.buttonsResponseMessage || m.templateButtonReplyMessage || m.listResponseMessage) {
      kind = "button";
      buttonId = m.buttonsResponseMessage?.selectedButtonId ?? m.templateButtonReplyMessage?.selectedId ?? m.listResponseMessage?.singleSelectReply?.selectedRowId ?? null;
      text = m.buttonsResponseMessage?.selectedDisplayText ?? m.templateButtonReplyMessage?.selectedDisplayText ?? m.listResponseMessage?.title ?? null;
    } else if (m.imageMessage) {
      kind = "image";
      text = m.imageMessage.caption ?? null;
      mime = m.imageMessage.mimetype ?? "image/jpeg";
    } else if (m.audioMessage) {
      kind = "audio";
      mime = m.audioMessage.mimetype ?? "audio/ogg";
    } else if (doc) {
      kind = "document";
      text = doc.caption ?? null;
      mime = doc.mimetype ?? null;
      nome = doc.fileName ?? null;
    } else if (m.locationMessage || m.liveLocationMessage) {
      const l = m.locationMessage ?? m.liveLocationMessage!;
      if (typeof l.degreesLatitude === "number" && typeof l.degreesLongitude === "number") {
        kind = "location";
        const lm = m.locationMessage;
        location = { lat: l.degreesLatitude, lng: l.degreesLongitude, endereco: [lm?.name, lm?.address].filter(Boolean).join(" – ") || null };
      }
    }
    const idMsg = k.id;
    const temMidia = kind === "image" || kind === "audio" || kind === "document";
    const ts = Number(d.messageTimestamp ?? 0);
    out.push({
      channelId: canal.id,
      providerMessageId: idMsg,
      chatId: jid,
      replyTarget: jid,
      from: { phoneE164: phone, name: k.fromMe ? null : d.pushName ?? null },
      isGroup,
      fromMe: !!k.fromMe,
      // Evolution não marca envios via API; o eco é reconhecido pelo id já gravado (dedup) ou texto recente.
      sentByApi: !!k.fromMe && d.source === "api",
      kind,
      text,
      buttonId,
      location,
      media: temMidia
        ? {
            mime,
            nome,
            fetch: async () => {
              if (m.base64) return { dados: Buffer.from(m.base64, "base64"), mime: mime ?? "application/octet-stream", nome };
              const r = await api<{ base64?: string; mimetype?: string; fileName?: string }>(canal as CanalRuntime, `/chat/getBase64FromMediaMessage/${instancia(canal as CanalRuntime)}`, { message: { key: { id: idMsg } }, convertToMp4: false });
              if (!r.base64) throw new ErroProvedor("Mídia indisponível na Evolution API.");
              return { dados: Buffer.from(r.base64, "base64"), mime: r.mimetype ?? mime ?? "application/octet-stream", nome: r.fileName ?? nome };
            },
          }
        : null,
      timestamp: ts > 0 ? new Date(ts * 1000) : new Date(),
    });
  }
  return out;
}

export const evolution: Provedor = {
  tipo: "WHATSAPP_EVOLUTION",
  oficial: () => false,
  limitarRitmo: true,
  verifyWebhook(req: RequisicaoWebhook, canal: CanalRuntime) {
    const h = req.headers.get("x-webhook-secret") ?? req.url.searchParams.get("token");
    return iguaisSeguro(h, canal.webhookSecret);
  },
  parseWebhook(corpo, _ct, canal) {
    return normalizarEvolution(JSON.parse(corpo), canal);
  },
  parseStatusConexao(corpo) {
    const b = JSON.parse(corpo) as { event?: string; data?: { state?: string } };
    const ev = String(b?.event ?? "").toLowerCase().replace(/_/g, ".");
    if (ev === "connection.update") return b.data?.state ?? null;
    if (ev === "qrcode.updated") return "qrcode";
    return null;
  },
  async sendText(canal, destino, texto) {
    const r = await api<{ key?: { id?: string } }>(canal, `/message/sendText/${instancia(canal)}`, { number: destino, text: texto, delay: 1200 });
    return { providerMessageId: r?.key?.id ?? null };
  },
  async sendMedia(canal, destino, midia) {
    const tipo = midia.mime.startsWith("image/") ? "image" : midia.mime.startsWith("audio/") ? "audio" : "document";
    const r = await api<{ key?: { id?: string } }>(canal, `/message/sendMedia/${instancia(canal)}`, {
      number: destino, mediatype: tipo, mimetype: midia.mime, caption: midia.legenda ?? "", media: midia.dados.toString("base64"), fileName: midia.nome,
    });
    return { providerMessageId: r?.key?.id ?? null };
  },
  // Sem sendButtons: botões no Baileys são instáveis – o despachante usa o texto numerado.
  async setTyping(canal, destino) {
    await api(canal, `/chat/sendPresence/${instancia(canal)}`, { number: destino, delay: 1500, presence: "composing" }).catch(() => {});
  },
  async connect(canal, webhookUrl) {
    exigirConfig(canal);
    const inst = instancia(canal);
    // Cria a instância se ainda não existir
    const existentes = await api<{ name?: string; instance?: { instanceName?: string } }[]>(canal, `/instance/fetchInstances?instanceName=${inst}`).catch(() => []);
    const existe = Array.isArray(existentes) && existentes.some((i) => (i.name ?? i.instance?.instanceName) === canal.config.instance_name);
    if (!existe) await api(canal, "/instance/create", { instanceName: canal.config.instance_name, integration: "WHATSAPP-BAILEYS", qrcode: true });
    await configurarWebhookEvolution(canal, webhookUrl);
    const st = await this.status!(canal);
    if (st.estado === "open") return { estado: "open", mensagem: "Instância já conectada ao WhatsApp." };
    const qr = await api<{ base64?: string; code?: string; pairingCode?: string }>(canal, `/instance/connect/${inst}`);
    return { estado: st.estado, qrcode: qr.base64 ?? null, mensagem: qr.pairingCode ? `Código de pareamento: ${qr.pairingCode}` : undefined };
  },
  async status(canal) {
    const r = await api<{ instance?: { state?: string }; state?: string }>(canal, `/instance/connectionState/${instancia(canal)}`);
    return { estado: r.instance?.state ?? r.state ?? "desconhecido" };
  },
};

export async function configurarWebhookEvolution(canal: CanalRuntime, url: string) {
  await api(canal, `/webhook/set/${instancia(canal)}`, {
    webhook: {
      enabled: true, url, webhookByEvents: false, webhookBase64: false,
      headers: { "x-webhook-secret": canal.webhookSecret },
      events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
    },
  });
}
