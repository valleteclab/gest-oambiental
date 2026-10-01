// E-mail de entrada (webhook de inbound parse) e resposta por e-mail (lib/email.ts).
// Formato principal: JSON do Postmark Inbound. Também aceita SendGrid Inbound Parse (multipart), convertido pela
// rota em JSON {formato:"sendgrid", campos, anexos} antes de gravar o evento. Uma conversa por remetente + assunto
// (as respostas levam "Re: <assunto> [Atendimento #xxxxxxxx]"; o assunto-base é o mesmo, então a volta cai na mesma conversa).
import type { CanalRuntime, InboundEvent, Provedor } from "./tipos";
import { ehEmail, iguaisSeguro } from "./contato";

type PostmarkIn = {
  From?: string;
  FromName?: string;
  FromFull?: { Email?: string; Name?: string };
  Subject?: string;
  MessageID?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Headers?: { Name: string; Value: string }[];
  Attachments?: { Name?: string; Content?: string; ContentType?: string; ContentLength?: number }[];
};
export type SendgridConvertido = { formato: "sendgrid"; campos: Record<string, string>; anexos: { nome: string; mime: string; base64: string }[] };

const RE_REF = /\[Atendimento #([a-z0-9]{8})\]/i;

/** Assunto sem prefixos de resposta/encaminhamento e sem a referência. */
export function assuntoBase(s: string | null | undefined): string {
  let t = (s ?? "").replace(RE_REF, "").trim();
  for (let i = 0; i < 5; i++) t = t.replace(/^(re|res|enc|fw|fwd|tr)\s*:\s*/i, "").trim();
  return t.slice(0, 150);
}

export const referenciaDoAssunto = (s: string | null | undefined) => RE_REF.exec(s ?? "")?.[1]?.toLowerCase() ?? null;

/** Remove a citação da mensagem anterior (linhas com ">" e "Em …, … escreveu:" / "On … wrote:"). */
export function removerCitacao(texto: string): string {
  const linhas = texto.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of linhas) {
    if (/^\s*(Em .+escreveu:|On .+wrote:|-----\s*Original Message|De: .+|From: .+)\s*$/i.test(l)) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

const semHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

function extrairEmail(v: string | undefined | null): { email: string | null; nome: string | null } {
  if (!v) return { email: null, nome: null };
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(v);
  const email = (m ? m[2] : v).trim().toLowerCase();
  return { email: ehEmail(email) ? email : null, nome: m?.[1]?.trim() || null };
}

/** Normaliza Postmark (JSON) ou SendGrid convertido. Exportado para testes. */
export function normalizarEmail(corpo: unknown, canal: Pick<CanalRuntime, "id">): InboundEvent[] {
  let remetente: { email: string | null; nome: string | null };
  let assunto: string;
  let id: string;
  let texto: string;
  let anexos: { nome: string; mime: string; base64: string }[] = [];
  const sg = corpo as SendgridConvertido;
  if (sg && sg.formato === "sendgrid") {
    remetente = extrairEmail(sg.campos.from);
    assunto = sg.campos.subject ?? "";
    const hdr = sg.campos.headers ?? "";
    id = /^Message-ID:\s*(.+)$/im.exec(hdr)?.[1]?.trim() ?? `${remetente.email}:${assunto}:${(sg.campos.text ?? "").length}:${hdr.length}`;
    texto = removerCitacao(sg.campos.text || semHtml(sg.campos.html ?? ""));
    anexos = sg.anexos ?? [];
  } else {
    const p = corpo as PostmarkIn;
    if (!p || (!p.From && !p.FromFull)) return [];
    remetente = p.FromFull?.Email ? { email: p.FromFull.Email.toLowerCase(), nome: p.FromFull.Name || null } : extrairEmail(p.From);
    if (!remetente.nome && p.FromName) remetente.nome = p.FromName;
    assunto = p.Subject ?? "";
    id = p.MessageID || p.Headers?.find((h) => h.Name.toLowerCase() === "message-id")?.Value || `${remetente.email}:${p.Date}:${assunto}`;
    texto = (p.StrippedTextReply?.trim() || removerCitacao(p.TextBody || semHtml(p.HtmlBody ?? ""))).trim();
    anexos = (p.Attachments ?? []).filter((a) => a.Content).map((a) => ({ nome: a.Name ?? "anexo", mime: a.ContentType ?? "application/octet-stream", base64: a.Content! }));
  }
  if (!remetente.email) return [];
  const ref = referenciaDoAssunto(assunto);
  // Mesma conversa para o assunto original e as respostas ("Re: … [Atendimento #xxxxxxxx]"): o assunto-base não
  // inclui prefixos nem a referência.
  const chatId = `${remetente.email}|${assuntoBase(assunto).toLowerCase()}`;
  const base = {
    channelId: canal.id, chatId, replyTarget: remetente.email, from: { phoneE164: null, email: remetente.email, name: remetente.nome },
    isGroup: false, fromMe: false, sentByApi: false, timestamp: new Date(), extra: { assunto, referencia: ref },
  };
  const eventos: InboundEvent[] = [];
  if (texto) eventos.push({ ...base, providerMessageId: id, kind: "text", text: texto.slice(0, 5000) });
  anexos.slice(0, 5).forEach((a, i) => {
    const imagem = a.mime.startsWith("image/");
    eventos.push({
      ...base, providerMessageId: `${id}#${i + 1}`, kind: imagem ? "image" : "document", text: null,
      media: { mime: a.mime, nome: a.nome, fetch: async () => ({ dados: Buffer.from(a.base64, "base64"), mime: a.mime, nome: a.nome }) },
    });
  });
  return eventos;
}

export const email: Provedor = {
  tipo: "EMAIL",
  oficial: () => false,
  limitarRitmo: false,
  verifyWebhook(req, canal) {
    const auth = req.headers.get("authorization");
    let senhaBasic: string | null = null;
    if (auth?.startsWith("Basic ")) senhaBasic = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":").slice(1).join(":");
    return [req.url.searchParams.get("token"), req.headers.get("x-webhook-secret"), senhaBasic].some((t) => iguaisSeguro(t, canal.webhookSecret));
  },
  parseWebhook(corpo, _ct, canal) {
    return normalizarEmail(JSON.parse(corpo), canal);
  },
  async sendText(canal, destino, texto, opcoes) {
    const { enviarEmail } = await import("../email");
    const { textoParaHtml } = await import("./formatar");
    const assunto = `Re: ${assuntoBase(opcoes?.assunto) || "Denúncia ambiental"}${opcoes?.referencia ? ` [Atendimento #${opcoes.referencia}]` : ""}`;
    const r = await enviarEmail(destino, assunto, textoParaHtml(texto), { replyTo: canal.config.endereco_entrada || null });
    return { providerMessageId: `email:${r.id}` };
  },
};
