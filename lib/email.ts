import nodemailer from "nodemailer";
import { prisma } from "./db";

// E-mail transacional. Todo envio é registrado em email_enviado (serve de "caixa de teste" – T3).
export async function enviarEmail(para: string, assunto: string, corpo: string, opcoes: { replyTo?: string | null } = {}) {
  const reg = await prisma.emailEnviado.create({ data: { para, assunto, corpo } });
  if (!process.env.SMTP_URL) return reg; // sem SMTP: fica só na caixa de teste (/admin/emails)
  try {
    const t = nodemailer.createTransport(process.env.SMTP_URL);
    await t.sendMail({ from: process.env.EMAIL_FROM, to: para, subject: assunto, html: corpo, ...(opcoes.replyTo ? { replyTo: opcoes.replyTo } : {}) });
    await prisma.emailEnviado.update({ where: { id: reg.id }, data: { enviado: true } });
  } catch (e) {
    await prisma.emailEnviado.update({ where: { id: reg.id }, data: { erro: String(e) } });
  }
  return reg;
}
