import "server-only";
import type { StatusDenuncia } from "@prisma/client";
import { prisma } from "../db";
import { carregarCanal } from "../canais";
import { dadosDe, jsonDados } from "./conversas";
import { enviarRespostas } from "./envio";
import * as T from "./textos";

// Aviso ao cidadão quando a situação da denúncia muda (EM_APURACAO / CONCLUIDA / ARQUIVADA), pelo canal da conversa
// de origem. Chatwoot/WhatsApp oficial fora da janela de 24 h: não envia e registra "requer template aprovado"
// (regra em enviarRespostas). E-mail: sempre envia. Chat do site: a mensagem fica na conversa.
export async function notificarStatusDenuncia(denunciaId: string, status: StatusDenuncia) {
  if (status === "NOVA") return;
  const den = await prisma.denuncia.findUnique({ where: { id: denunciaId }, select: { protocolo: true, conversa: true } });
  const conv = den?.conversa;
  if (!den || !conv) return;
  const canal = await carregarCanal(conv.canal_id);
  const ativo = await prisma.canalAtendimento.findUnique({ where: { id: conv.canal_id }, select: { ativo: true } });
  if (!canal || !ativo?.ativo) return;
  if (status === "CONCLUIDA") await prisma.conversa.update({ where: { id: conv.id }, data: { dados_coletados: jsonDados({ ...dadosDe(conv), avaliacao_pendente: true }) } });
  await enviarRespostas(canal, conv, [T.notificacaoStatus(den.protocolo, status)], "SISTEMA");
}
