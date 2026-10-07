// Regras PURAS do fluxo de assinatura (turno, transições de estado, prazo, lembretes, formatação) – sem banco.
// Testadas em tests/unit/ged-assinaturas.test.ts.
import type { GedModoAssinatura, GedStatusAssinante, GedStatusDocumento, GedStatusSolicitacao } from "@prisma/client";

export const MODOS: readonly GedModoAssinatura[] = ["SEQUENCIAL", "PARALELO"];
export const METODO_ELETRONICA_AVANCADA = "ELETRONICA_AVANCADA" as const;
export const REAUTENTICACAO_SENHA = "SENHA" as const;
export const MIN_JUSTIFICATIVA = 10;
export const MAX_SIGNATARIOS = 20;
export const MIN_PRAZO_DIAS = 1;
export const MAX_PRAZO_DIAS = 90;
/** Texto de consentimento mostrado (e gravado em auditoria) no ato de assinar. */
export const TEXTO_CONSENTIMENTO =
  "Declaro que li o documento acima e que assino por meio eletrônico, com minha senha pessoal, " +
  "ciente de que esta é uma assinatura eletrônica avançada (Lei nº 14.063/2020) e produz os efeitos jurídicos nela previstos.";

// ───────────── Documento ─────────────

/** Estados do documento em que se pode abrir uma solicitação (RECUSADO = nova tentativa após recusa). */
export const STATUS_DOC_PERMITE_SOLICITAR: readonly GedStatusDocumento[] = ["RASCUNHO", "PUBLICADO", "RECUSADO"];
export const podeSolicitarNoStatus = (s: GedStatusDocumento) => STATUS_DOC_PERMITE_SOLICITAR.includes(s);

// ───────────── Montagem e turno ─────────────

export type SignatarioMin = { id: string; ordem: number; status: GedStatusAssinante; usuario_id?: string };

/** Linhas iniciais: SEQUENCIAL – o primeiro PENDENTE, os demais AGUARDANDO; PARALELO – todos PENDENTE (ordem só de exibição). */
export function montarAssinantes(modo: GedModoAssinatura, usuarioIds: string[]): { usuario_id: string; ordem: number; status: GedStatusAssinante }[] {
  return usuarioIds.map((usuario_id, i) => ({ usuario_id, ordem: i + 1, status: modo === "SEQUENCIAL" && i > 0 ? "AGUARDANDO" : "PENDENTE" }));
}

/** O signatário `id` pode assinar AGORA? (a linha está PENDENTE e, no sequencial, todos os anteriores já assinaram). */
export function podeAssinarAgora(modo: GedModoAssinatura, assinantes: SignatarioMin[], id: string): boolean {
  const eu = assinantes.find((a) => a.id === id);
  if (!eu || eu.status !== "PENDENTE") return false;
  if (modo === "PARALELO") return true;
  return assinantes.filter((a) => a.ordem < eu.ordem).every((a) => a.status === "ASSINADO");
}

/** Ids a promover de AGUARDANDO para PENDENTE depois de uma assinatura (sequencial: o próximo da fila; paralelo: ninguém). */
export function proximosAPromover(modo: GedModoAssinatura, assinantes: SignatarioMin[]): string[] {
  if (modo !== "SEQUENCIAL") return [];
  const ordenados = [...assinantes].sort((a, b) => a.ordem - b.ordem);
  const primeiroNaoAssinado = ordenados.find((a) => a.status !== "ASSINADO");
  return primeiroNaoAssinado && primeiroNaoAssinado.status === "AGUARDANDO" ? [primeiroNaoAssinado.id] : [];
}

export const todosAssinaram = (assinantes: Pick<SignatarioMin, "status">[]) => assinantes.length > 0 && assinantes.every((a) => a.status === "ASSINADO");

/** Signatário da vez (menor ordem PENDENTE) – para exibição "aguardando fulano". */
export function daVez(assinantes: SignatarioMin[]): SignatarioMin | null {
  return [...assinantes].filter((a) => a.status === "PENDENTE").sort((a, b) => a.ordem - b.ordem)[0] ?? null;
}

// ───────────── Transições ─────────────

const TRANSICOES_SOLICITACAO: Record<GedStatusSolicitacao, readonly GedStatusSolicitacao[]> = {
  ABERTA: ["CONCLUIDA", "RECUSADA", "CANCELADA", "EXPIRADA"],
  CONCLUIDA: [],
  RECUSADA: [],
  CANCELADA: [],
  EXPIRADA: [],
};
export const podeTransitarSolicitacao = (de: GedStatusSolicitacao, para: GedStatusSolicitacao) => TRANSICOES_SOLICITACAO[de].includes(para);

const TRANSICOES_ASSINANTE: Record<GedStatusAssinante, readonly GedStatusAssinante[]> = {
  AGUARDANDO: ["PENDENTE", "EXPIRADO"],
  PENDENTE: ["ASSINADO", "RECUSADO", "EXPIRADO"],
  ASSINADO: [],
  RECUSADO: [],
  EXPIRADO: [],
};
export const podeTransitarAssinante = (de: GedStatusAssinante, para: GedStatusAssinante) => TRANSICOES_ASSINANTE[de].includes(para);

/** Estado das solicitações encerradas sem selo (volta o documento para PUBLICADO) ou com recusa (RECUSADO). */
export function statusDocumentoAposEncerrar(s: GedStatusSolicitacao): GedStatusDocumento | null {
  if (s === "RECUSADA") return "RECUSADO";
  if (s === "CANCELADA" || s === "EXPIRADA") return "PUBLICADO";
  if (s === "CONCLUIDA") return "ASSINADO";
  return null;
}

// ───────────── Tempo (Brasília) ─────────────

export const FUSO_BRASILIA = "America/Sao_Paulo";
const OFFSET_BRASILIA_H = 3; // UTC-3 o ano todo (sem horário de verão desde 2019)

/** Data civil de Brasília (aaaa-mm-dd) de um instante. */
export function diaBrasilia(d: Date): string {
  return new Date(d.getTime() - OFFSET_BRASILIA_H * 3600_000).toISOString().slice(0, 10);
}
export const horaBrasilia = (d: Date): number => new Date(d.getTime() - OFFSET_BRASILIA_H * 3600_000).getUTCHours();

/** Prazo: fim (23:59:59.999, Brasília) do dia `dias` dias depois de `agora`. */
export function calcularPrazoAssinatura(agora: Date, dias: number): Date {
  const [a, m, d] = diaBrasilia(agora).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias, 23 + OFFSET_BRASILIA_H, 59, 59, 999));
}

/** Dias CIVIS (Brasília) de `de` até `ate`; negativo = já passou. */
export function diasCivisEntre(de: Date, ate: Date): number {
  const [a1, m1, d1] = diaBrasilia(de).split("-").map(Number);
  const [a2, m2, d2] = diaBrasilia(ate).split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400_000);
}

export const prazoExpirado = (prazo_em: Date, agora: Date) => agora.getTime() > prazo_em.getTime();

/** Janela de envio de lembretes (hora de Brasília): não acordar ninguém de madrugada. */
export const JANELA_LEMBRETE = { de: 8, ate: 20 } as const;

/**
 * O lembrete "D-n" está devido? Limiar = menor `l` de `lembrete_dias` com l >= dias restantes. Considera-se já enviado
 * quando o último aviso (ou a criação, se nunca houve) já estava dentro desse limiar. Só dentro da janela de horário.
 */
export function lembreteDevido(p: { prazo_em: Date; agora: Date; criada_em: Date; ultimo_lembrete_em: Date | null; lembrete_dias: number[] }): boolean {
  const { prazo_em, agora } = p;
  if (prazoExpirado(prazo_em, agora)) return false;
  const h = horaBrasilia(agora);
  if (h < JANELA_LEMBRETE.de || h >= JANELA_LEMBRETE.ate) return false;
  const restantes = diasCivisEntre(agora, prazo_em);
  const limiar = [...p.lembrete_dias].filter((l) => l >= restantes).sort((a, b) => a - b)[0];
  if (limiar === undefined) return false;
  const referencia = p.ultimo_lembrete_em ?? p.criada_em;
  return diasCivisEntre(referencia, prazo_em) > limiar;
}

const dois = (n: number) => String(n).padStart(2, "0");
/** dd/mm/aaaa HH:mm (horário de Brasília). */
export function fmtDataHoraBrasilia(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const t = new Date(new Date(d).getTime() - OFFSET_BRASILIA_H * 3600_000);
  return `${dois(t.getUTCDate())}/${dois(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${dois(t.getUTCHours())}:${dois(t.getUTCMinutes())}`;
}
export function fmtDataBrasilia(d: Date | string | null | undefined): string {
  return d ? fmtDataHoraBrasilia(d).slice(0, 10) : "—";
}

// ───────────── Código verificador, URL e rodapé ─────────────

const RE_CODIGO = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
/** Formato XXXX-XXXX-XXXX (alfabeto sem 0/O/1/I – lib/crypto.ts). */
export const ehCodigoVerificador = (s: unknown): s is string => typeof s === "string" && RE_CODIGO.test(s);

/** Normaliza o que o usuário digitou/colou (caixa, hífens, O→0 como em lib/documentos/render.ts); null = formato inválido. */
export function normalizarCodigoGed(v: string | null | undefined): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0");
  if (s.length !== 12) return null;
  const c = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  return RE_CODIGO.test(c) ? c : null;
}

export const baseUrlApp = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const urlVerificacao = (codigo: string, base: string = baseUrlApp()) => `${base.replace(/\/+$/, "")}/verificar/${codigo}`;

/** Texto curto do rodapé de cada página (somente Latin-1/WinAnsi – a fonte padrão do PDF). */
export function textoRodapeSelo(codigo: string, url: string): { linha1: string; linha2: string; codigo: string } {
  const host = url.replace(/^https?:\/\//, "").replace(/\/verificar\/.*$/, "");
  return { linha1: "Documento assinado eletronicamente", linha2: `Verifique em ${host}/verificar`, codigo: `Codigo ${codigo}` };
}

// ───────────── Rodapé: geometria por rotação de página ─────────────

/** Converte um ponto do referencial VISUAL da página (origem no canto inferior esquerdo, como vista) para o nativo do PDF. */
export function visualParaNativo(rot: number, w: number, h: number, vx: number, vy: number): { x: number; y: number; angulo: number } {
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x: w - vy, y: vx, angulo: 90 };
    case 180: return { x: w - vx, y: h - vy, angulo: 180 };
    case 270: return { x: vy, y: h - vx, angulo: 270 };
    default: return { x: vx, y: vy, angulo: 0 };
  }
}
