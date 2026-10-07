// Modelos das notificações do GED (e-mail e WhatsApp) – funções PURAS (sem banco/rede), testadas em tests/unit/ged-notificar.test.ts.
//
// Regras (docs/ged-design.md §4):
//  - sem anexos; link para o documento (`${APP_URL}/ged/documentos/{id}`) ou para a lista de assinaturas (`/ged/assinaturas`);
//  - o TÍTULO do documento só aparece se a sensibilidade não for SIGILOSO (senão, apenas o número);
//  - "Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)" é calculado NO MOMENTO DO ENVIO (parâmetro `agora` do job), nunca ao enfileirar;
//  - todo texto dinâmico é escapado no HTML.
import type { GedSensibilidade } from "@prisma/client";
import { NOME_MODULO_GED } from "./tipos";
import type { EventoNotificacao } from "./notificar/regras";

export const FUSO_BRASILIA = "America/Sao_Paulo";

export type DocumentoTemplate = { id: string; numero: string; titulo: string; sensibilidade: GedSensibilidade };

export type ContextoTemplate = {
  evento: EventoNotificacao;
  organizacao_nome: string;
  destinatario_nome: string;
  documento?: DocumentoTemplate | null;
  /** Quem enviou/compartilhou (derivado do banco no envio). */
  remetente_nome?: string | null;
  /** Prazo da solicitação de assinatura (assinatura solicitada/lembrete). */
  prazo_em?: Date | null;
  /** Código de 6 dígitos (somente CONFIRMACAO_WHATSAPP). */
  codigo?: string | null;
  app_url: string;
  /** Instante do ENVIO (relógio do job). */
  agora: Date;
};

export type EmailRenderizado = { assunto: string; texto: string; html: string };

// ───────────── Utilitários ─────────────

export function escHtml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function partesBrasilia(d: Date) {
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_BRASILIA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return p;
}

/** "07/10/2026 às 14:30" (horário de Brasília). */
export function dataHoraBrasilia(d: Date): string {
  const p = partesBrasilia(d);
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`;
}

/** "07/10/2026" (horário de Brasília). */
export function dataBrasilia(d: Date): string {
  const p = partesBrasilia(d);
  return `${p.day}/${p.month}/${p.year}`;
}

/** Linha obrigatória do e-mail (item 5 do edital). */
export const linhaEnviadoEm = (agora: Date) => `Enviado em ${dataHoraBrasilia(agora)} (horário de Brasília)`;

const semBarra = (u: string) => u.replace(/\/+$/, "");

export function linkDoEvento(ctx: Pick<ContextoTemplate, "evento" | "documento" | "app_url">): string {
  const base = semBarra(ctx.app_url);
  const assinar = ctx.evento === "ASSINATURA_SOLICITADA" || ctx.evento === "ASSINATURA_LEMBRETE";
  if (assinar || !ctx.documento) return `${base}/ged/assinaturas`;
  return `${base}/ged/documentos/${ctx.documento.id}`;
}

/** Identificação do documento no texto: número, mais o título se NÃO for sigiloso. */
export function nomeDocumento(d: DocumentoTemplate | null | undefined): string {
  if (!d) return "um documento";
  return d.sensibilidade === "SIGILOSO" ? `documento ${d.numero}` : `documento ${d.numero} – ${d.titulo}`;
}

const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] || "";

/** Assunto gravado ao enfileirar (só o número: o título nunca vai no assunto). */
export function assuntoEvento(evento: EventoNotificacao, numero?: string | null): string {
  const n = numero ? ` ${numero}` : "";
  switch (evento) {
    case "TRAMITE_RECEBIDO": return `Documento${n} recebido em trâmite`;
    case "ASSINATURA_SOLICITADA": return `Assinatura solicitada: documento${n}`;
    case "ASSINATURA_CONCLUIDA": return `Assinaturas concluídas: documento${n}`;
    case "ASSINATURA_RECUSADA": return `Assinatura recusada: documento${n}`;
    case "ASSINATURA_LEMBRETE": return `Lembrete: assinatura pendente do documento${n}`;
    case "ASSINATURA_EXPIRADA": return `Solicitação de assinatura expirada: documento${n}`;
    case "ASSINATURA_CANCELADA": return `Solicitação de assinatura cancelada: documento${n}`;
    case "DOCUMENTO_COMPARTILHADO": return `Documento${n} compartilhado com você`;
    case "CONFIRMACAO_WHATSAPP": return `${NOME_MODULO_GED}: código de confirmação do WhatsApp`;
  }
}

/** Frases do corpo: o que aconteceu e a ação exigida. */
function mensagem(c: ContextoTemplate): { fato: string; acao: string } {
  const doc = nomeDocumento(c.documento);
  const de = c.remetente_nome ? ` por ${c.remetente_nome}` : "";
  const prazo = c.prazo_em ? ` até ${dataBrasilia(c.prazo_em)}` : "";
  switch (c.evento) {
    case "TRAMITE_RECEBIDO":
      return { fato: `O ${doc} foi encaminhado a você${de}.`, acao: "Acesse o documento para dar ciência e, se for o caso, despachar, encaminhar ou devolver." };
    case "ASSINATURA_SOLICITADA":
      return { fato: `Você foi indicado(a) como signatário(a) do ${doc}${de ? ` (solicitação feita${de})` : ""}.`, acao: `Revise o documento e assine ou recuse (com justificativa)${prazo}.` };
    case "ASSINATURA_CONCLUIDA":
      return { fato: `Todas as assinaturas do ${doc} foram concluídas.`, acao: "Acesse o documento para consultar o arquivo assinado e o código verificador." };
    case "ASSINATURA_RECUSADA":
      return { fato: `A solicitação de assinatura do ${doc} foi recusada por um signatário.`, acao: "Acesse o documento para ver a justificativa e decidir os próximos passos." };
    case "ASSINATURA_LEMBRETE":
      return { fato: `Sua assinatura no ${doc} continua pendente.`, acao: `Acesse a lista de assinaturas e assine ou recuse${prazo}.` };
    case "ASSINATURA_EXPIRADA":
      return { fato: `A solicitação de assinatura do ${doc} expirou sem que todas as assinaturas fossem concluídas.`, acao: "Acesse o documento para abrir uma nova solicitação, se necessário." };
    case "ASSINATURA_CANCELADA":
      return { fato: `A solicitação de assinatura do ${doc} foi cancelada (o documento foi alterado ou a solicitação foi retirada).`, acao: "Nenhuma ação é necessária agora. Se o documento voltar a ser enviado para assinatura, você será avisado(a) novamente." };
    case "DOCUMENTO_COMPARTILHADO":
      return { fato: `O ${doc} foi compartilhado com você${de}.`, acao: "Acesse o documento para consultá-lo." };
    case "CONFIRMACAO_WHATSAPP":
      return { fato: "Recebemos o pedido para ativar notificações por WhatsApp neste número.", acao: "Informe o código em Minhas notificações." };
  }
}

// ───────────── E-mail ─────────────

export function renderEmail(c: ContextoTemplate): EmailRenderizado {
  const assunto = assuntoEvento(c.evento, c.documento?.numero ?? null);
  const { fato, acao } = mensagem(c);
  const link = linkDoEvento(c);
  const enviado = linhaEnviadoEm(c.agora);
  const saudacao = `Olá, ${primeiroNome(c.destinatario_nome) || "tudo bem"}.`;
  const codigo = c.evento === "CONFIRMACAO_WHATSAPP" && c.codigo ? `Código: ${c.codigo} (válido por 10 minutos)` : null;

  const texto = [
    `${NOME_MODULO_GED} – ${c.organizacao_nome}`,
    "",
    saudacao,
    fato,
    codigo,
    `Ação necessária: ${acao}`,
    "",
    `Acesse: ${link}`,
    "",
    enviado,
    "Mensagem automática; não responda a este e-mail.",
  ].filter((x) => x !== null).join("\n");

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:16px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
<div style="background:#0f4c3a;color:#ffffff;padding:14px 20px"><strong>${escHtml(NOME_MODULO_GED)}</strong><div style="font-size:13px;opacity:.9">${escHtml(c.organizacao_nome)}</div></div>
<div style="padding:20px;font-size:15px;line-height:1.5">
<p style="margin:0 0 12px">${escHtml(saudacao)}</p>
<p style="margin:0 0 12px">${escHtml(fato)}</p>
${codigo ? `<p style="margin:0 0 12px;font-size:22px;letter-spacing:4px"><strong>${escHtml(c.codigo)}</strong><span style="font-size:13px;letter-spacing:0"> (válido por 10 minutos)</span></p>` : ""}
<p style="margin:0 0 16px"><strong>Ação necessária:</strong> ${escHtml(acao)}</p>
<p style="margin:0 0 20px"><a href="${escHtml(link)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Abrir no ${escHtml(NOME_MODULO_GED)}</a></p>
<p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">Se o botão não abrir, copie o endereço: ${escHtml(link)}</p>
</div>
<div style="border-top:1px solid #e2e8f0;padding:12px 20px;font-size:12px;color:#475569"><div data-linha="enviado-em">${escHtml(enviado)}</div><div>Mensagem automática; não responda a este e-mail. Sem anexos: acesse o sistema para ver o documento.</div></div>
</div></body></html>`;

  return { assunto, texto, html };
}

// ───────────── WhatsApp ─────────────

/** Texto curto (sem título de documento sigiloso), com link e a data/hora de envio. */
export function renderWhatsapp(c: ContextoTemplate): string {
  if (c.evento === "CONFIRMACAO_WHATSAPP") {
    return `${NOME_MODULO_GED}: seu código de confirmação é ${c.codigo ?? "------"}. Válido por 10 minutos. Se não foi você, ignore esta mensagem.`;
  }
  const { fato, acao } = mensagem(c);
  return [`*${NOME_MODULO_GED}* – ${c.organizacao_nome}`, fato, acao, `Acesse: ${linkDoEvento(c)}`, linhaEnviadoEm(c.agora)].join("\n");
}
