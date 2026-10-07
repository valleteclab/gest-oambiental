import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { invalido, naoEncontrado } from "../http";
import { montarRuntime, novoSegredoWebhook } from "../canais";
import { hashChat } from "../canais/contato";
import type { InboundEvent } from "../canais/tipos";
import { lerArquivo } from "../storage";
import { processarInbound } from "./ingestao";

// Chat do site: um canal WEBCHAT por município (criado automaticamente na primeira conversa; o ADMIN pode desativá-lo
// em /admin/canais). A sessão do visitante é um token aleatório em cookie httpOnly (lg_chat).

export const COOKIE_CHAT = "lg_chat";

export async function municipioPublico(ref: string) {
  const v = ref.trim();
  if (!v) return null;
  const uuid = /^[0-9a-f-]{36}$/i.test(v);
  return prisma.municipio.findFirst({ where: { ativo: true, organizacao: { status: "ATIVO", modulos: { has: "LICENCIAMENTO" } }, ...(uuid ? { id: v } : { sigla: v.toUpperCase() }) }, select: { id: true, nome: true, sigla: true, organizacao_id: true, latitude: true, longitude: true } });
}

/** Canal WEBCHAT do município (cria se não existir). null se desativado pelo ADMIN. */
export async function canalWebchat(municipio: { id: string; nome: string; organizacao_id: string }) {
  let c = await prisma.canalAtendimento.findFirst({ where: { tipo: "WEBCHAT", municipio_id: municipio.id }, orderBy: { created_at: "asc" } });
  if (!c) c = await prisma.canalAtendimento.create({ data: { tipo: "WEBCHAT", nome: `Chat do site – ${municipio.nome}`, organizacao_id: municipio.organizacao_id, municipio_id: municipio.id, webhook_secret: novoSegredoWebhook(), config: {} } });
  return c.ativo ? montarRuntime(c) : null;
}

export async function chatDisponivel(municipioId: string) {
  const c = await prisma.canalAtendimento.findFirst({ where: { tipo: "WEBCHAT", municipio_id: municipioId }, select: { ativo: true } });
  return !c || c.ativo;
}

export type EntradaWeb = { texto?: string | null; botao?: string | null; latitude?: number | null; longitude?: number | null; foto?: { dados: Buffer; nome: string; mime: string } | null; cliente_id?: string | null };

export async function mensagemWeb(municipioRef: string, token: string, e: EntradaWeb) {
  const mun = await municipioPublico(municipioRef);
  if (!mun) throw invalido("Município inválido.");
  const canal = await canalWebchat(mun);
  if (!canal) throw invalido("O chat está indisponível para este município. Use o formulário.");
  const texto = e.texto?.trim().slice(0, 2000) || null;
  const temLocal = typeof e.latitude === "number" && typeof e.longitude === "number";
  if (!texto && !e.botao && !temLocal && !e.foto) throw invalido("Mensagem vazia.");
  const foto = e.foto;
  const ev: InboundEvent = {
    channelId: canal.id,
    providerMessageId: `web:${e.cliente_id && /^[\w-]{8,64}$/.test(e.cliente_id) ? e.cliente_id : randomUUID()}`,
    chatId: token, replyTarget: token, from: { phoneE164: null, name: null }, isGroup: false, fromMe: false, sentByApi: false,
    kind: foto ? "image" : temLocal ? "location" : e.botao ? "button" : "text",
    // botão: o rótulo clicado fica como texto visível na conversa; quem decide é o id
    text: texto, buttonId: e.botao && /^[a-z_]{2,30}$/.test(e.botao) ? e.botao : null,
    location: temLocal ? { lat: e.latitude!, lng: e.longitude! } : null,
    media: foto ? { mime: foto.mime, nome: foto.nome, fetch: async () => ({ dados: foto.dados, mime: foto.mime, nome: foto.nome }) } : null,
    timestamp: new Date(),
  };
  const r = await processarInbound(canal, ev);
  return { resultado: r, ...(await mensagensWeb(mun.id, token)) };
}

/** Mensagens da conversa mais recente deste visitante (sem dados pessoais: só texto/tipo). */
export async function mensagensWeb(municipioId: string, token: string, desde?: Date | null) {
  const canal = await prisma.canalAtendimento.findFirst({ where: { tipo: "WEBCHAT", municipio_id: municipioId }, select: { id: true } });
  if (!canal) return { estado: null, mensagens: [] };
  const conv = await prisma.conversa.findFirst({ where: { canal_id: canal.id, chat_hash: hashChat(canal.id, token) }, orderBy: { created_at: "desc" }, select: { id: true, estado: true } });
  if (!conv) return { estado: null, mensagens: [] };
  const msgs = await prisma.mensagemConversa.findMany({
    where: { conversa_id: conv.id, ...(desde ? { created_at: { gt: desde } } : {}) }, orderBy: { created_at: "asc" }, take: 200,
    select: { id: true, direcao: true, autor: true, tipo: true, texto: true, botoes: true, midia_key: true, latitude: true, longitude: true, created_at: true },
  });
  return {
    estado: conv.estado,
    mensagens: msgs.map((m) => ({
      id: m.id, direcao: m.direcao, autor: m.autor, tipo: m.tipo, texto: m.texto, botoes: m.botoes as { id: string; rotulo: string }[] | null,
      midia: !!m.midia_key && m.tipo === "IMAGEM", local: m.latitude != null, created_at: m.created_at,
    })),
  };
}

export async function encerrarWeb(municipioId: string, token: string) {
  const canal = await prisma.canalAtendimento.findFirst({ where: { tipo: "WEBCHAT", municipio_id: municipioId }, select: { id: true } });
  if (!canal) return;
  await prisma.conversa.updateMany({ where: { canal_id: canal.id, chat_hash: hashChat(canal.id, token), estado: { not: "ENCERRADA" } }, data: { estado: "ENCERRADA" } });
}

/** Foto enviada pelo próprio visitante (confere o token da sessão). */
export async function midiaWeb(mensagemId: string, token: string) {
  const m = await prisma.mensagemConversa.findUnique({ where: { id: mensagemId }, select: { midia_key: true, midia_mime: true, tipo: true, conversa: { select: { chat_hash: true, canal_id: true, canal: { select: { tipo: true } } } } } });
  if (!m?.midia_key || m.tipo !== "IMAGEM" || m.conversa.canal.tipo !== "WEBCHAT" || m.conversa.chat_hash !== hashChat(m.conversa.canal_id, token)) throw naoEncontrado();
  return { dados: await lerArquivo(m.midia_key), mime: m.midia_mime ?? "image/jpeg" };
}
