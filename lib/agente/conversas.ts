import "server-only";
import type { Conversa, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { cifrar } from "../crypto";
import { hashChat, hashContato } from "../canais/contato";
import type { CanalRuntime, InboundEvent } from "../canais/tipos";
import type { DadosColetados } from "./tipos";

// Conversas: serialização por chat (advisory lock do Postgres) e busca/criação da conversa aberta.

const locais = new Map<string, Promise<unknown>>();

/**
 * Executa `fn` com exclusão mútua por `chave` entre TODOS os processos (pg_advisory_xact_lock numa transação que só
 * segura o lock) e, dentro do processo, em fila (não ocupa várias conexões do pool para o mesmo chat).
 */
export function comLock<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = locais.get(chave) ?? Promise.resolve();
  const exec = anterior.catch(() => undefined).then(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))) AS l`;
        return fn();
      },
      { timeout: 300_000, maxWait: 120_000 },
    ),
  );
  const fim = exec.catch(() => undefined).finally(() => {
    if (locais.get(chave) === fim) locais.delete(chave);
  });
  locais.set(chave, fim);
  return exec;
}

export const chaveLock = (canalId: string, chatId: string) => `conv:${hashChat(canalId, chatId)}`;

export const dadosDe = (c: Pick<Conversa, "dados_coletados">) => ((c.dados_coletados ?? {}) as DadosColetados) || {};
export const jsonDados = (d: DadosColetados) => d as unknown as Prisma.InputJsonValue;

export async function conversaAberta(canalId: string, chatId: string) {
  return prisma.conversa.findFirst({ where: { canal_id: canalId, chat_hash: hashChat(canalId, chatId), estado: { not: "ENCERRADA" } }, orderBy: { created_at: "desc" } });
}

/** Conversa aberta do chat ou uma nova (INICIO). Contato (telefone/e-mail) guardado cifrado + hash. */
export async function obterOuCriarConversa(canal: CanalRuntime, ev: Pick<InboundEvent, "chatId" | "replyTarget" | "from" | "extra">, dadosIniciais: DadosColetados = {}) {
  const existente = await conversaAberta(canal.id, ev.chatId);
  if (existente) return existente;
  const contato = ev.from.phoneE164 ?? ev.from.email ?? null;
  try {
    return await prisma.conversa.create({
      data: {
        canal_id: canal.id, organizacao_id: canal.organizacao_id, municipio_id: canal.municipio_id,
        chat_hash: hashChat(canal.id, ev.chatId), destino_cifrado: cifrar(ev.replyTarget),
        contato_hash: hashContato(contato), contato_cifrado: contato ? cifrar(contato) : null,
        nome: ev.from.name?.slice(0, 150) ?? null, estado: "INICIO",
        dados_coletados: jsonDados({ ...dadosIniciais, assunto_email: ev.extra?.assunto ?? null }),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      const c = await conversaAberta(canal.id, ev.chatId);
      if (c) return c;
    }
    throw e;
  }
}

/** O mesmo contato já consentiu (LGPD) numa conversa deste canal nos últimos 180 dias? */
export async function consentimentoAnterior(canalId: string, contatoHash: string | null): Promise<Date | null> {
  if (!contatoHash) return null;
  const c = await prisma.conversa.findFirst({
    where: { canal_id: canalId, contato_hash: contatoHash, lgpd_consentimento_em: { gte: new Date(Date.now() - 180 * 86400000) } },
    orderBy: { lgpd_consentimento_em: "desc" }, select: { lgpd_consentimento_em: true },
  });
  return c?.lgpd_consentimento_em ?? null;
}
