import "server-only";
import type { CanalAtendimento, Prisma, TipoCanal } from "@prisma/client";
import { prisma } from "../db";
import { cifrar, decifrar } from "../crypto";
import type { CanalRuntime, Provedor } from "./tipos";
import { zapi } from "./zapi";
import { evolution } from "./evolution";
import { chatwoot } from "./chatwoot";
import { webchat } from "./webchat";
import { email } from "./email";
import { gerarSegredo } from "./contato";

// Registro dos provedores + carga/gravação da configuração cifrada dos canais.

const PROVEDORES: Record<TipoCanal, Provedor> = {
  WHATSAPP_ZAPI: zapi,
  WHATSAPP_EVOLUTION: evolution,
  WHATSAPP_CHATWOOT: chatwoot,
  WEBCHAT: webchat,
  EMAIL: email,
};

export const provedor = (tipo: TipoCanal): Provedor => PROVEDORES[tipo];

/** Campos de configuração por tipo: públicos (config) e secretos (cifrados). */
export const CAMPOS_CANAL: Record<TipoCanal, { publicos: { k: string; rotulo: string; dica?: string }[]; segredos: { k: string; rotulo: string; dica?: string }[] }> = {
  WHATSAPP_EVOLUTION: {
    publicos: [
      { k: "instance_name", rotulo: "Nome da instância", dica: "Ex.: lor-denuncias (criada automaticamente na Evolution API)." },
      { k: "base_url", rotulo: "URL da Evolution API (opcional)", dica: "Vazio = EVOLUTION_BASE_URL do servidor." },
    ],
    segredos: [{ k: "api_key", rotulo: "API key (opcional)", dica: "Vazio = EVOLUTION_API_KEY do servidor." }],
  },
  WHATSAPP_ZAPI: {
    publicos: [{ k: "instance_id", rotulo: "ID da instância (instanceId)" }],
    segredos: [
      { k: "token", rotulo: "Token da instância" },
      { k: "client_token", rotulo: "Client-Token (token de segurança da conta)" },
    ],
  },
  WHATSAPP_CHATWOOT: {
    publicos: [
      { k: "url", rotulo: "URL do Chatwoot", dica: "Ex.: https://chat.seudominio.com.br" },
      { k: "account_id", rotulo: "ID da conta (account)" },
      { k: "inbox_id", rotulo: "ID da caixa (inbox) WhatsApp" },
      { k: "janela_24h", rotulo: "Aplicar janela de 24 h (API oficial)", dica: "true (padrão) ou false." },
    ],
    segredos: [
      { k: "api_token", rotulo: "Token de acesso (api_access_token) do agente-bot" },
      { k: "hmac_secret", rotulo: "Segredo HMAC do webhook (opcional)" },
    ],
  },
  WEBCHAT: { publicos: [], segredos: [] },
  EMAIL: {
    publicos: [{ k: "endereco_entrada", rotulo: "E-mail de entrada (Reply-To)", dica: "Ex.: denuncias@orgao.gov.br – encaminhado ao inbound do Postmark/SendGrid." }],
    segredos: [],
  },
};

export const ROTULO_TIPO_CANAL: Record<TipoCanal, string> = {
  WHATSAPP_EVOLUTION: "WhatsApp (Evolution API)",
  WHATSAPP_ZAPI: "WhatsApp (Z-API)",
  WHATSAPP_CHATWOOT: "WhatsApp oficial (Chatwoot)",
  WEBCHAT: "Chat do site",
  EMAIL: "E-mail",
};

type ConfigGravada = Record<string, unknown> & { segredos?: string };

export function montarRuntime(c: Pick<CanalAtendimento, "id" | "tipo" | "nome" | "organizacao_id" | "municipio_id" | "config" | "webhook_secret">): CanalRuntime {
  const cfg = (c.config ?? {}) as ConfigGravada;
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg)) if (k !== "segredos" && v !== null && v !== undefined) config[k] = String(v);
  let segredos: Record<string, string> = {};
  if (typeof cfg.segredos === "string" && cfg.segredos) {
    try {
      segredos = JSON.parse(decifrar(cfg.segredos) ?? "{}");
    } catch {
      segredos = {};
    }
  }
  return { id: c.id, tipo: c.tipo, nome: c.nome, organizacao_id: c.organizacao_id, municipio_id: c.municipio_id, config, segredos, webhookSecret: decifrar(c.webhook_secret) ?? "" };
}

/** Monta o JSON a gravar: campos públicos em claro, credenciais cifradas (mantém segredos não reenviados). */
export function montarConfig(tipo: TipoCanal, publicos: Record<string, string>, segredosNovos: Record<string, string>, anterior?: CanalRuntime | null): Prisma.InputJsonValue {
  const campos = CAMPOS_CANAL[tipo];
  const config: Record<string, string> = {};
  for (const c of campos.publicos) if (publicos[c.k]) config[c.k] = publicos[c.k];
  const seg: Record<string, string> = { ...(anterior?.segredos ?? {}) };
  for (const c of campos.segredos) if (segredosNovos[c.k]) seg[c.k] = segredosNovos[c.k];
  return Object.keys(seg).length ? { ...config, segredos: cifrar(JSON.stringify(seg)) } : config;
}

export const novoSegredoWebhook = () => cifrar(gerarSegredo());

export async function carregarCanal(id: string): Promise<CanalRuntime | null> {
  const c = await prisma.canalAtendimento.findUnique({ where: { id } });
  return c ? montarRuntime(c) : null;
}

export function urlBase(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** URL do webhook a configurar no provedor. Z-API/Chatwoot/e-mail levam o segredo na URL; Evolution usa header. */
export function urlWebhook(c: Pick<CanalRuntime, "id" | "tipo" | "webhookSecret">, comToken = c.tipo !== "WHATSAPP_EVOLUTION"): string {
  const u = `${urlBase()}/api/webhooks/${c.id}`;
  return comToken ? `${u}?token=${encodeURIComponent(c.webhookSecret)}` : u;
}

/** Envio simulado (testes/homologação): registra no log em vez de chamar o provedor. */
export const envioSimulado = () => process.env.CANAIS_ENVIO_SIMULADO === "true";

// ───────── Ritmo de envio (provedores não oficiais): 1 mensagem a cada 3–8 s por instância ─────────
const filas = new Map<string, Promise<void>>();
const ultimoEnvio = new Map<string, number>();

export function intervaloEnvio(): { min: number; max: number } {
  const min = Number(process.env.CANAIS_INTERVALO_MIN_MS ?? 3000);
  const max = Number(process.env.CANAIS_INTERVALO_MAX_MS ?? 8000);
  return { min, max: Math.max(min, max) };
}

/** Executa `fn` respeitando o intervalo mínimo por canal (fila em memória por processo). */
export function comRitmo<T>(canal: CanalRuntime, fn: () => Promise<T>): Promise<T> {
  if (!provedor(canal.tipo).limitarRitmo || envioSimulado()) return fn();
  const anterior = filas.get(canal.id) ?? Promise.resolve();
  const exec = anterior.then(async () => {
    const { min, max } = intervaloEnvio();
    const espera = (ultimoEnvio.get(canal.id) ?? 0) + min + Math.random() * (max - min) - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    try {
      return await fn();
    } finally {
      ultimoEnvio.set(canal.id, Date.now());
    }
  });
  filas.set(canal.id, exec.then(() => undefined, () => undefined));
  return exec;
}
