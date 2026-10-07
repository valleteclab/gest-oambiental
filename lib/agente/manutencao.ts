import "server-only";
import { prisma } from "../db";
import { carregarCanal } from "../canais";
import { dadosDe } from "./conversas";
import { enviarRespostas } from "./envio";
import * as T from "./textos";

// Rotina periódica (job `canais-manutencao`, a cada 15 min):
//  • HUMANO com pausa vencida → volta ao estado anterior (IA reativada);
//  • inatividade > AGENTE_INATIVIDADE_H (6 h) → ENCERRADA (avisa se a denúncia estava incompleta);
//  • retenção da caixa bruta de webhooks (CANAIS_RETENCAO_EVENTOS_DIAS, padrão 15 dias – contém dados pessoais).
export async function manutencaoCanais(agora = new Date()) {
  const r = { reativadas: 0, encerradas: 0, eventos_removidos: 0 };
  const pausadas = await prisma.conversa.findMany({ where: { estado: "HUMANO", ia_pausada_ate: { lt: agora } }, take: 500 });
  for (const c of pausadas) {
    const anterior = (dadosDe(c).estado_anterior as typeof c.estado | undefined) || "COLETANDO";
    await prisma.conversa.update({ where: { id: c.id }, data: { estado: anterior === "HUMANO" ? "COLETANDO" : anterior, ia_pausada_ate: null } });
    r.reativadas++;
  }
  const horas = Number(process.env.AGENTE_INATIVIDADE_H ?? 6);
  const limite = new Date(agora.getTime() - horas * 3600 * 1000);
  const inativas = await prisma.conversa.findMany({ where: { estado: { notIn: ["ENCERRADA", "HUMANO"] }, ultima_msg_em: { lt: limite } }, take: 500 });
  for (const c of inativas) {
    await prisma.conversa.update({ where: { id: c.id }, data: { estado: "ENCERRADA" } });
    r.encerradas++;
    if (c.estado === "COLETANDO" || c.estado === "CONFIRMANDO" || c.estado === "AGUARDANDO_LGPD") {
      const canal = await carregarCanal(c.canal_id);
      if (canal && canal.tipo !== "EMAIL") await enviarRespostas(canal, c, [T.encerradaInatividade()], "SISTEMA").catch((e) => console.error("[agente] aviso inatividade", e));
    }
  }
  const dias = Number(process.env.CANAIS_RETENCAO_EVENTOS_DIAS ?? 15);
  const del = await prisma.eventoWebhook.deleteMany({ where: { recebido_em: { lt: new Date(agora.getTime() - dias * 86400000) } } });
  r.eventos_removidos = del.count;
  return r;
}
