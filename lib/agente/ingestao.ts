import "server-only";
import { prisma } from "../db";
import { carregarCanal, provedor } from "../canais";
import type { CanalRuntime, InboundEvent } from "../canais/tipos";
import { chaveLock, comLock, conversaAberta, dadosDe, jsonDados, obterOuCriarConversa } from "./conversas";
import { PAUSA_HUMANO_MS, processarMensagemCidadao, verificarLimite, type ResultadoProcessamento } from "./orquestrador";

// Ingestão: webhook → evento_webhook (caixa bruta) → fila pg-boss `canal-mensagem` (worker) ou processamento
// em segundo plano no próprio processo web (sem worker) → dedup → lock por chat → orquestrador.

const TIPO_MSG: Record<InboundEvent["kind"], string> = { text: "TEXTO", image: "IMAGEM", audio: "AUDIO", document: "DOCUMENTO", location: "LOCALIZACAO", button: "BOTAO", unknown: "OUTRO" };

/** Processa UMA mensagem normalizada (com lock por chat). */
export async function processarInbound(canal: CanalRuntime, ev: InboundEvent): Promise<ResultadoProcessamento> {
  // Canal usado só para ENVIAR notificações do GED (config.somente_envio="true"): respostas de usuários nunca entram no agente de denúncias.
  if (canal.config?.somente_envio === "true") return "IGNORADA";
  if (ev.isGroup) return "IGNORADA";
  if (ev.fromMe && ev.sentByApi) return "IGNORADA"; // eco do que a própria API enviou
  return comLock(chaveLock(canal.id, ev.chatId), async () => {
    const jaExiste = await prisma.mensagemConversa.findUnique({ where: { canal_id_provider_message_id: { canal_id: canal.id, provider_message_id: ev.providerMessageId } }, select: { id: true } });
    if (jaExiste) return "DUPLICADA";

    // ── Mensagem enviada pelo número/caixa do órgão, mas não pela nossa API → atendente humano assumiu ──
    if (ev.fromMe) {
      const conv = await conversaAberta(canal.id, ev.chatId);
      if (!conv) return "IGNORADA";
      const eco = ev.text
        ? await prisma.mensagemConversa.findFirst({ where: { conversa_id: conv.id, direcao: "OUT", texto: ev.text, created_at: { gte: new Date(Date.now() - 5 * 60000) } }, select: { id: true } })
        : null;
      if (eco) return "DUPLICADA";
      await prisma.mensagemConversa.create({ data: { conversa_id: conv.id, canal_id: canal.id, direcao: "OUT", autor: "ATENDENTE", provider_message_id: ev.providerMessageId, tipo: TIPO_MSG[ev.kind], texto: ev.text, status_envio: "ENVIADA" } });
      const d = dadosDe(conv);
      await prisma.conversa.update({
        where: { id: conv.id },
        data: { estado: "HUMANO", ia_pausada_ate: new Date(Date.now() + PAUSA_HUMANO_MS), ultima_msg_em: new Date(), dados_coletados: jsonDados({ ...d, estado_anterior: conv.estado === "HUMANO" ? d.estado_anterior : conv.estado }) },
      });
      return "HUMANO";
    }

    let conv = await obterOuCriarConversa(canal, ev);
    let msg;
    try {
      msg = await prisma.mensagemConversa.create({
        data: {
          conversa_id: conv.id, canal_id: canal.id, direcao: "IN", autor: "CIDADAO", provider_message_id: ev.providerMessageId, tipo: TIPO_MSG[ev.kind],
          texto: ev.text?.slice(0, 5000) ?? null, latitude: ev.location?.lat ?? null, longitude: ev.location?.lng ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return "DUPLICADA";
      throw e;
    }
    const agora = new Date();
    conv = await prisma.conversa.update({ where: { id: conv.id }, data: { ultima_msg_em: agora, ultima_msg_cidadao_em: agora, ...(ev.from.name && !conv.nome ? { nome: ev.from.name.slice(0, 150) } : {}) } });

    if (conv.estado === "HUMANO") {
      if (conv.ia_pausada_ate && conv.ia_pausada_ate > agora) return "HUMANO";
      const d = dadosDe(conv);
      conv = await prisma.conversa.update({ where: { id: conv.id }, data: { estado: (d.estado_anterior as typeof conv.estado) || "COLETANDO", ia_pausada_ate: null } });
    }
    if (await verificarLimite(canal, conv)) return "LIMITE";
    return processarMensagemCidadao(canal, conv, msg, ev);
  });
}

// ───────── Eventos de webhook ─────────

/** Processa um evento PENDENTE (seguro contra execução dupla). */
export async function processarEvento(id: string): Promise<void> {
  const tomado = await prisma.eventoWebhook.updateMany({ where: { id, status: "PENDENTE" }, data: { status: "PROCESSANDO", tentativas: { increment: 1 } } });
  if (!tomado.count) return;
  const ev = await prisma.eventoWebhook.findUniqueOrThrow({ where: { id } });
  const c = await prisma.canalAtendimento.findUnique({ where: { id: ev.canal_id } });
  if (!c || !c.ativo) {
    await prisma.eventoWebhook.update({ where: { id }, data: { status: "IGNORADO", processado_em: new Date(), erro: "Canal inativo." } });
    return;
  }
  const canal = await carregarCanal(c.id);
  if (!canal) {
    // carregarCanal devolve null quando o cliente está suspenso (painel /plataforma)
    await prisma.eventoWebhook.update({ where: { id }, data: { status: "IGNORADO", processado_em: new Date(), erro: "Cliente suspenso." } });
    return;
  }
  const prov = provedor(canal.tipo);
  try {
    const conexao = prov.parseStatusConexao?.(ev.corpo) ?? null;
    if (conexao) await prisma.canalAtendimento.update({ where: { id: c.id }, data: { status_conexao: conexao } });
    const eventos = prov.parseWebhook(ev.corpo, ev.content_type, canal);
    const resultados: string[] = [];
    for (const e of eventos) resultados.push(await processarInbound(canal, e));
    await prisma.eventoWebhook.update({ where: { id }, data: { status: eventos.length || conexao ? "PROCESSADO" : "IGNORADO", processado_em: new Date(), erro: resultados.length ? resultados.join(",") : null } });
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 1000) ?? String(e);
    console.error(`[agente] evento ${id}:`, msg);
    await prisma.eventoWebhook.update({ where: { id }, data: { status: ev.tentativas + 1 < 3 ? "PENDENTE" : "ERRO", erro: msg } });
  }
}

/** Eventos PENDENTES (varredura do worker) – e PROCESSANDO travados há > 10 min voltam a PENDENTE. */
export async function eventosPendentes(limite = 50): Promise<string[]> {
  await prisma.eventoWebhook.updateMany({ where: { status: "PROCESSANDO", recebido_em: { lt: new Date(Date.now() - 10 * 60000) }, tentativas: { lt: 3 } }, data: { status: "PENDENTE" } });
  return (await prisma.eventoWebhook.findMany({ where: { status: "PENDENTE" }, orderBy: { recebido_em: "asc" }, take: limite, select: { id: true } })).map((e) => e.id);
}

/** Worker pg-boss no ar? (mesmo critério da exportação: application_name das conexões). */
export async function workerNoAr(): Promise<boolean> {
  try {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE application_name = 'licenciagov-worker' AND datname = current_database()`;
    return Number(r[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Grava o evento bruto e dispara o processamento (worker ou fire-and-forget). */
export async function receberEvento(canalId: string, corpo: string, contentType: string | null) {
  const ev = await prisma.eventoWebhook.create({ data: { canal_id: canalId, corpo, content_type: contentType } });
  await prisma.canalAtendimento.update({ where: { id: canalId }, data: { ultimo_evento_em: new Date() } }).catch(() => {});
  const viaWorker = process.env.CANAIS_INLINE !== "true" && (await workerNoAr());
  if (!viaWorker) void processarEvento(ev.id).catch((e) => console.error(`[agente] evento ${ev.id}`, e));
  return { id: ev.id, via: viaWorker ? "worker" : "inline" };
}
