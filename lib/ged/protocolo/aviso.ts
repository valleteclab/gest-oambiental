// Avisos por e-mail ao INTERESSADO externo do protocolo, pela mesma caixa de saída do GED (GedComunicacao PENDENTE; o envio é
// do job `ged-notificar` → lib/ged/notificar/enviar.ts → enviarAvisoProtocolo). Sem anexos: o e-mail leva só o link de consulta.
import type { GedLivroProtocolo, GedSituacaoProtocolo, Prisma } from "@prisma/client";
import { enviarEmail } from "@/lib/email";
import type { GedDb, GedTx } from "../db";
import { baseUrlApp } from "../assinaturas/regras";
import { lerInteressado, mascararEmailInteressado } from "./pessoal";
import { rotuloSituacao } from "./regras";
import { assuntoEmailProtocolo, renderEmailProtocolo, type EventoProtocolo } from "./templates";

type ProtocoloAviso = { id: string; numero: string; livro: GedLivroProtocolo; situacao: GedSituacaoProtocolo; interessado_email_cifrado: string | null };

/** Enfileira o aviso (na transação do chamador). Sem e-mail do interessado, ou no livro INTERNO, não faz nada. */
export async function enfileirarAvisoInteressado(tx: GedTx, p: ProtocoloAviso, evento: EventoProtocolo): Promise<boolean> {
  if (p.livro === "INTERNO" || !p.interessado_email_cifrado) return false;
  const { email } = lerInteressado({ interessado_email_cifrado: p.interessado_email_cifrado });
  if (!email) return false;
  await tx.gedComunicacao.create({
    data: {
      protocolo_id: p.id,
      usuario_id: null,
      evento,
      canal: "EMAIL",
      destinatario_mascarado: mascararEmailInteressado(email),
      assunto: assuntoEmailProtocolo(evento, p.numero, rotuloSituacao(p.situacao, p.livro)),
      status: "PENDENTE",
    } as Prisma.GedComunicacaoUncheckedCreateInput,
  });
  return true;
}

/** Link da página pública de consulta (só existe com o portal ligado e o endereço público definido). */
export function linkConsulta(slug: string | null, numero: string, codigo: string, base: string = baseUrlApp()): string | null {
  if (!slug) return null;
  return `${base.replace(/\/+$/, "")}/protocolo/${slug}/consulta?numero=${encodeURIComponent(numero)}&codigo=${encodeURIComponent(codigo)}`;
}

export type DesfechoAviso = { status: "ENVIADA" | "SIMULADA" | "ERRO" | "IGNORADA"; erro?: string | null; email_enviado_id?: string | null; transitorio?: boolean };

/** Envio de UMA linha da caixa de saída ligada a um protocolo. Chamado por processarComunicacao (gedDb do cliente). */
export async function enviarAvisoProtocolo(db: GedDb, organizacaoId: string, linha: { protocolo_id: string | null; evento: string }, agora: Date): Promise<DesfechoAviso> {
  if (!linha.protocolo_id || (linha.evento !== "PROTOCOLO_RECEBIDO" && linha.evento !== "PROTOCOLO_SITUACAO")) return { status: "IGNORADA", erro: "Evento de protocolo desconhecido." };
  const p = await db.gedProtocolo.findUnique({ where: { id: linha.protocolo_id } });
  if (!p) return { status: "IGNORADA", erro: "Protocolo não encontrado." };
  const i = lerInteressado(p);
  if (!i.email) return { status: "IGNORADA", erro: "Interessado sem e-mail cadastrado." };
  const [org, cfg] = await Promise.all([
    db.organizacao.findUnique({ where: { id: organizacaoId }, select: { nome: true, slug_publico: true } }),
    db.gedConfig.findFirst({ select: { protocolo_portal_ativo: true } }),
  ]);
  const r = renderEmailProtocolo({
    evento: linha.evento,
    organizacao_nome: org?.nome ?? "",
    destinatario_nome: i.nome,
    numero: p.numero,
    assunto: p.assunto,
    situacao_rotulo: rotuloSituacao(p.situacao, p.livro),
    codigo_consulta: p.codigo_consulta,
    link_consulta: cfg?.protocolo_portal_ativo ? linkConsulta(org?.slug_publico ?? null, p.numero, p.codigo_consulta) : null,
    agora,
  });
  const reg = await enviarEmail(i.email, r.assunto, r.html);
  if (!process.env.SMTP_URL) return { status: "SIMULADA", email_enviado_id: reg.id }; // caixa de teste (/admin/emails)
  const fim = await db.emailEnviado.findUnique({ where: { id: reg.id }, select: { enviado: true, erro: true } });
  if (fim?.enviado) return { status: "ENVIADA", email_enviado_id: reg.id };
  return { status: "ERRO", email_enviado_id: reg.id, erro: (fim?.erro ?? "Falha no envio do e-mail.").slice(0, 300), transitorio: true };
}
