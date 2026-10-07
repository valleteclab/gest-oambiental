// E-mails ao INTERESSADO externo do protocolo (confirmação de recebimento e mudanças de situação) – funções PURAS.
// Regras: sem anexos (só link de consulta), "Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)" calculado no envio,
// nada de despacho interno nem nome de servidor; todo texto dinâmico escapado.
import { escHtml, linhaEnviadoEm } from "../templates";

export type EventoProtocolo = "PROTOCOLO_RECEBIDO" | "PROTOCOLO_SITUACAO";
export const ROTULO_EVENTO_PROTOCOLO: Record<EventoProtocolo, string> = {
  PROTOCOLO_RECEBIDO: "Protocolo recebido (confirmação ao interessado)",
  PROTOCOLO_SITUACAO: "Mudança de situação do protocolo (aviso ao interessado)",
};
export const ehEventoProtocolo = (e: string): e is EventoProtocolo => e === "PROTOCOLO_RECEBIDO" || e === "PROTOCOLO_SITUACAO";

export type ContextoEmailProtocolo = {
  evento: EventoProtocolo;
  organizacao_nome: string;
  destinatario_nome: string | null;
  numero: string;
  assunto: string;
  situacao_rotulo: string;
  codigo_consulta: string;
  /** Link da página de consulta pública (sem segredos na query além do que o próprio e-mail já entrega). */
  link_consulta: string | null;
  agora: Date;
};

export function assuntoEmailProtocolo(evento: EventoProtocolo, numero: string, situacao: string): string {
  return evento === "PROTOCOLO_RECEBIDO" ? `Protocolo ${numero} recebido` : `Protocolo ${numero}: ${situacao}`;
}

const primeiroNome = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || "";

export function renderEmailProtocolo(c: ContextoEmailProtocolo): { assunto: string; texto: string; html: string } {
  const assunto = assuntoEmailProtocolo(c.evento, c.numero, c.situacao_rotulo);
  const saudacao = `Olá${primeiroNome(c.destinatario_nome) ? `, ${primeiroNome(c.destinatario_nome)}` : ""}.`;
  const fato =
    c.evento === "PROTOCOLO_RECEBIDO"
      ? `Recebemos o seu protocolo ${c.numero} (${c.assunto}).`
      : `O seu protocolo ${c.numero} (${c.assunto}) mudou de situação: ${c.situacao_rotulo}.`;
  const acao = "Para acompanhar o andamento, informe o número do protocolo e o código de consulta na página do órgão.";
  const enviado = linhaEnviadoEm(c.agora);
  const texto = [
    `${c.organizacao_nome} – Protocolo online`, "", saudacao, fato, `Código de consulta: ${c.codigo_consulta}`, acao,
    c.link_consulta ? `Acompanhar: ${c.link_consulta}` : "", "", enviado, "Mensagem automática; não responda a este e-mail. Sem anexos.",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:16px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
<div style="background:#0f4c3a;color:#ffffff;padding:14px 20px"><strong>Protocolo online</strong><div style="font-size:13px;opacity:.9">${escHtml(c.organizacao_nome)}</div></div>
<div style="padding:20px;font-size:15px;line-height:1.5">
<p style="margin:0 0 12px">${escHtml(saudacao)}</p>
<p style="margin:0 0 12px">${escHtml(fato)}</p>
<p style="margin:0 0 12px">Número: <strong>${escHtml(c.numero)}</strong><br>Código de consulta: <strong style="font-family:monospace;letter-spacing:1px">${escHtml(c.codigo_consulta)}</strong></p>
<p style="margin:0 0 16px">${escHtml(acao)}</p>
${c.link_consulta ? `<p style="margin:0 0 20px"><a href="${escHtml(c.link_consulta)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Acompanhar o protocolo</a></p>
<p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">Se o botão não abrir, copie o endereço: ${escHtml(c.link_consulta)}</p>` : ""}
</div>
<div style="border-top:1px solid #e2e8f0;padding:12px 20px;font-size:12px;color:#475569"><div data-linha="enviado-em">${escHtml(enviado)}</div><div>Mensagem automática; não responda a este e-mail. Sem anexos: acompanhe pelo link.</div></div>
</div></body></html>`;
  return { assunto, texto, html };
}
