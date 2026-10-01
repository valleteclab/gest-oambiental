// Tipos comuns da abstração de canais (WhatsApp Z-API/Evolution/Chatwoot, chat do site, e-mail).
// Sem dependências de servidor: usados também nos testes de normalização (tests/unit/canais*.test.ts).
import type { TipoCanal } from "@prisma/client";

export type TipoEntrada = "text" | "image" | "audio" | "document" | "location" | "button" | "unknown";

export type MidiaBaixada = { dados: Buffer; mime: string; nome?: string | null };

/** Mensagem recebida já normalizada (independente do provedor). */
export type InboundEvent = {
  channelId: string;
  /** Id da mensagem no provedor (dedup: UNIQUE(canal_id, provider_message_id)). */
  providerMessageId: string;
  /** Identificador estável do chat no provedor (JID, conversa Chatwoot, e-mail+assunto, sessão web). */
  chatId: string;
  /** Para onde responder (número/JID, id da conversa Chatwoot, e-mail…). */
  replyTarget: string;
  from: { phoneE164: string | null; email?: string | null; name: string | null };
  isGroup: boolean;
  /** Mensagem enviada pelo próprio número/caixa (eco do que enviamos ou atendente humano). */
  fromMe: boolean;
  /** Enviada pela nossa API (eco) – ignorar. fromMe && !sentByApi = atendente humano pelo celular/painel do provedor. */
  sentByApi: boolean;
  kind: TipoEntrada;
  text: string | null;
  /** Resposta a botão (id do botão), quando o provedor informa. */
  buttonId?: string | null;
  media?: { mime?: string | null; nome?: string | null; fetch: () => Promise<MidiaBaixada> } | null;
  location?: { lat: number; lng: number; endereco?: string | null } | null;
  timestamp: Date;
  /** Campos específicos (ex.: assunto do e-mail). */
  extra?: Record<string, string | null | undefined>;
};

export type Botao = { id: string; rotulo: string };

export type ResultadoEnvio = { providerMessageId?: string | null };

/** Canal carregado do banco, com configuração e segredos já decifrados (somente no servidor). */
export type CanalRuntime = {
  id: string;
  tipo: TipoCanal;
  nome: string;
  organizacao_id: string;
  municipio_id: string | null;
  /** Configuração pública (ex.: instance_name, url, account_id, inbox_id). */
  config: Record<string, string>;
  /** Credenciais (ex.: token, api_key, client_token, api_token, hmac_secret). */
  segredos: Record<string, string>;
  webhookSecret: string;
};

export type RequisicaoWebhook = { headers: Headers; url: URL; corpo: string };

export type OpcoesEnvio = { assunto?: string | null; referencia?: string | null };

export interface Provedor {
  tipo: TipoCanal;
  /** API oficial do WhatsApp (janela de 24 h: fora dela só template aprovado). */
  oficial: (canal: CanalRuntime) => boolean;
  /** Provedores não oficiais: limitar ritmo de envio (1 msg a cada 3–8 s por instância). */
  limitarRitmo: boolean;
  verifyWebhook(req: RequisicaoWebhook, canal: CanalRuntime): boolean;
  parseWebhook(corpo: string, contentType: string | null, canal: CanalRuntime): InboundEvent[];
  /** Estado de conexão informado por eventos (CONNECTION_UPDATE etc.), quando houver. */
  parseStatusConexao?(corpo: string): string | null;
  sendText(canal: CanalRuntime, destino: string, texto: string, opcoes?: OpcoesEnvio): Promise<ResultadoEnvio>;
  sendMedia?(canal: CanalRuntime, destino: string, midia: { dados: Buffer; mime: string; nome: string; legenda?: string }): Promise<ResultadoEnvio>;
  /** Opcional: botões nativos. Sem suporte (ou erro), o envio cai no texto numerado. */
  sendButtons?(canal: CanalRuntime, destino: string, texto: string, botoes: Botao[]): Promise<ResultadoEnvio>;
  setTyping?(canal: CanalRuntime, destino: string): Promise<void>;
  connect?(canal: CanalRuntime, webhookUrl: string): Promise<{ estado: string; qrcode?: string | null; mensagem?: string }>;
  status?(canal: CanalRuntime): Promise<{ estado: string; detalhe?: string }>;
}

/** Texto com os botões numerados (fallback universal): "1️⃣ Sim  2️⃣ Não". */
const NUMEROS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
export function textoComBotoes(texto: string, botoes: Botao[]): string {
  if (!botoes.length) return texto;
  const linhas = botoes.map((b, i) => `${NUMEROS[i] ?? `${i + 1}.`} ${b.rotulo}`);
  return `${texto}\n\n${linhas.join("\n")}`;
}
