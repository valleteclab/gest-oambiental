// Regras PURAS (sem banco/rede) do compartilhamento externo por link + OTP no WhatsApp – docs/ged.md §18.
// Testadas em tests/unit/ged-compartilhamento.test.ts.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { GedAnonimizacao, GedSensibilidade, GedStatusCompartilhamento, GedStatusDocumento, Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizarTelefone } from "@/lib/canais/telefone";

// ───────────── Constantes ─────────────

export const TOKEN_BYTES = 32;
export const OTP_DIGITOS = 6;
export const OTP_VALIDADE_MS = 10 * 60_000;
export const OTP_MAX_TENTATIVAS = 5;
export const OTP_REENVIO_MIN_S = 60;
export const OTP_MAX_ENVIOS_HORA = 5;
export const SESSAO_DESLIZANTE_MS = 30 * 60_000;
export const SESSAO_TETO_MS = 2 * 3_600_000;
export const VALIDADE_PADRAO_DIAS = 7;
export const VALIDADE_MAXIMA_DIAS = 30;
export const MAX_ITENS_CONGELADOS = 5000;
export const NOME_COOKIE_SESSAO = "ged_comp";

/** Todo 404 do fluxo público usa esta mensagem (link inexistente, expirado, revogado, recurso excluído… são indistinguíveis). */
export const MENSAGEM_LINK_INVALIDO = "Este link é inválido ou não está mais disponível.";

// ───────────── Token do link ─────────────

const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url, sem padding
export const tokenValido = (t: unknown): t is string => typeof t === "string" && RE_TOKEN.test(t);

/** Token de alta entropia (32 bytes do CSPRNG). Só o hash vai ao banco. */
export const gerarToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** Comparação em tempo constante de strings (hex/ASCII). */
export function iguaisTempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ───────────── OTP ─────────────

/** Código numérico de 6 dígitos do CSPRNG (uniforme, com zeros à esquerda). */
export const gerarOtp = (): string => String(randomInt(0, 10 ** OTP_DIGITOS)).padStart(OTP_DIGITOS, "0");
export const gerarSal = (): string => randomBytes(16).toString("hex");
/** Hash com sal (HMAC-SHA256 com o sal como chave), ligado ao link para que o código de um não valha em outro. */
export const hashOtp = (codigo: string, sal: string, linkId: string): string => createHmac("sha256", sal).update(`ged-compartilhamento-otp|${linkId}|${codigo}`).digest("hex");
export const conferirOtp = (informado: string, hash: string, sal: string, linkId: string): boolean => iguaisTempoConstante(hashOtp(informado, sal, linkId), hash);
/** Só dígitos; null se não tiver exatamente 6. */
export function normalizarCodigoOtp(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === OTP_DIGITOS ? d : null;
}

export type OtpEstado = { expira_em: Date; tentativas: number; usado_em: Date | null; invalidado_em: Date | null };
export type SituacaoOtp = "VIGENTE" | "USADO" | "INVALIDADO" | "EXPIRADO" | "SEM_TENTATIVAS";

export function situacaoOtp(o: OtpEstado, agora: Date): SituacaoOtp {
  if (o.usado_em) return "USADO";
  if (o.invalidado_em) return "INVALIDADO";
  if (o.expira_em.getTime() <= agora.getTime()) return "EXPIRADO";
  if (o.tentativas >= OTP_MAX_TENTATIVAS) return "SEM_TENTATIVAS";
  return "VIGENTE";
}

export type DecisaoEnvioOtp = { ok: true } | { ok: false; motivo: "INTERVALO" | "LIMITE_HORA"; retry_after_s: number };

/**
 * Reenvio: intervalo mínimo de 60 s entre envios e no máximo 5 envios por hora e por link.
 * `envios` = instantes de criação dos OTPs do link (qualquer ordem).
 */
export function decidirEnvioOtp(envios: readonly Date[], agora: Date): DecisaoEnvioOtp {
  const ms = agora.getTime();
  const naHora = envios.map((d) => d.getTime()).filter((t) => ms - t < 3_600_000).sort((a, b) => a - b);
  const ultimo = naHora[naHora.length - 1];
  if (ultimo !== undefined && ms - ultimo < OTP_REENVIO_MIN_S * 1000) return { ok: false, motivo: "INTERVALO", retry_after_s: Math.max(1, Math.ceil((ultimo + OTP_REENVIO_MIN_S * 1000 - ms) / 1000)) };
  if (naHora.length >= OTP_MAX_ENVIOS_HORA) return { ok: false, motivo: "LIMITE_HORA", retry_after_s: Math.max(1, Math.ceil((naHora[0] + 3_600_000 - ms) / 1000)) };
  return { ok: true };
}

/** Bloqueio progressivo do link por falhas SEGUIDAS de código: 5 → 1 min, 10 → 10 min, 15 → 1 h, 20+ → 24 h. */
export function bloqueioProgressivoMs(falhasSeguidas: number): number {
  if (falhasSeguidas >= 20) return 24 * 3_600_000;
  if (falhasSeguidas >= 15) return 3_600_000;
  if (falhasSeguidas >= 10) return 10 * 60_000;
  if (falhasSeguidas >= 5) return 60_000;
  return 0;
}

// ───────────── Máscaras e minimização ─────────────

/** E.164 brasileiro obrigatório (celular com 9). Devolve null se não for um WhatsApp plausível. */
export function normalizarWhatsapp(v: unknown): string | null {
  const n = normalizarTelefone(typeof v === "string" ? v : null);
  if (!n || !/^55\d{2}9\d{8}$/.test(n)) return null;
  return n;
}

/** "(75) 9****-8888" – exibição para quem compartilha (nunca o número completo). */
export function mascararWhatsapp(e164: string): string {
  const n = e164.replace(/\D/g, "");
  return n.startsWith("55") && n.length >= 12 ? `(${n.slice(2, 4)}) ${n.slice(4, 5)}****-${n.slice(-4)}` : `***${n.slice(-4)}`;
}
/** "••12" – o que o DESTINATÁRIO vê (só os 2 últimos dígitos). */
export const terminacaoWhatsapp = (e164: string): string => `••${e164.replace(/\D/g, "").slice(-2)}`;

/** IP truncado para o registro (IPv4 → /24; IPv6 → 3 primeiros grupos). Sem IP → null. */
export function truncarIp(ip: string | null | undefined): string | null {
  if (!ip || ip === "desconhecido") return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (ip.includes(":")) {
    const g = ip.split(":").filter((x, i) => x !== "" || i === 0).slice(0, 3);
    return `${g.join(":")}::`;
  }
  return null;
}
export const hashIp = (ip: string | null | undefined): string | null => (ip && ip !== "desconhecido" ? createHash("sha256").update(`ged-comp-ip|${ip}`).digest("hex").slice(0, 32) : null);
export const hashUserAgent = (ua: string | null | undefined): string => createHash("sha256").update(`ged-comp-ua|${ua ?? ""}`).digest("hex");

/** "Chrome em Windows" – resumo sem a cadeia completa do user-agent. */
export function resumirUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const so = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "sistema desconhecido";
  return `${nav} em ${so}`;
}

// ───────────── Validade ─────────────

/** Dias efetivos: pedido (ou padrão do cliente), nunca acima do teto do cliente nem de 30. */
export function resolverValidadeDias(pedido: number | null | undefined, cfg: { padrao?: number | null; maximo?: number | null } = {}): number {
  const maximo = Math.min(Math.max(Math.floor(cfg.maximo ?? VALIDADE_MAXIMA_DIAS), 1), VALIDADE_MAXIMA_DIAS);
  const padrao = Math.min(Math.max(Math.floor(cfg.padrao ?? VALIDADE_PADRAO_DIAS), 1), maximo);
  const dias = pedido === null || pedido === undefined || !Number.isFinite(pedido) ? padrao : Math.floor(pedido);
  if (dias < 1) return 1;
  return Math.min(dias, maximo);
}
export const calcularExpiracao = (agora: Date, dias: number): Date => new Date(agora.getTime() + dias * 86_400_000);

export type LinkVigencia = { status: GedStatusCompartilhamento; expira_em: Date };
/** O link ainda abre? (ATIVO e dentro da validade) */
export const linkVigente = (l: LinkVigencia, agora: Date): boolean => l.status === "ATIVO" && l.expira_em.getTime() > agora.getTime();
/** Situação exibida: um ATIVO vencido aparece como EXPIRADO mesmo antes de o job gravar. */
export const statusEfetivo = (l: LinkVigencia, agora: Date): GedStatusCompartilhamento => (l.status === "ATIVO" && l.expira_em.getTime() <= agora.getTime() ? "EXPIRADO" : l.status);

// ───────────── Elegibilidade (o que NUNCA/SÓ COM CONFIRMAÇÃO pode ser compartilhado) ─────────────

export type DocElegibilidade = {
  sensibilidade: GedSensibilidade;
  contem_dados_pessoais: boolean;
  anonimizacao_status: GedAnonimizacao;
  documento_original_id: string | null;
  status: GedStatusDocumento;
  excluido_em: Date | null;
};
export type MotivoBloqueio = "SIGILOSO" | "DADOS_PESSOAIS" | "ANONIMIZACAO_PENDENTE" | "EXCLUIDO" | "ARQUIVADO";

export const ROTULO_MOTIVO_BLOQUEIO: Record<MotivoBloqueio, string> = {
  SIGILOSO: "documento sigiloso nunca pode ser compartilhado externamente",
  DADOS_PESSOAIS: "documento que contém dados pessoais só pode ser compartilhado na versão anonimizada",
  ANONIMIZACAO_PENDENTE: "documento com anonimização pendente não pode ser compartilhado",
  EXCLUIDO: "documento excluído",
  ARQUIVADO: "documento arquivado",
};

/**
 * PURA: motivos que impedem o compartilhamento externo (vazio = pode).
 *  - SIGILOSO: nunca.
 *  - dados pessoais / anonimização: mesma régua de `whereExposicaoPublica` (anonimizacao.ts) – o original com dados pessoais (ou com
 *    anonimização PENDENTE/ANONIMIZADA) NÃO sai; só o derivado anonimizado (`documento_original_id`) sem a marca. Na dúvida, bloqueia.
 *  - RESTRITO é permitido, mas exige confirmação explícita (`exigeConfirmacaoRestrito`).
 */
export function motivosBloqueio(d: DocElegibilidade): MotivoBloqueio[] {
  const m: MotivoBloqueio[] = [];
  if (d.excluido_em) m.push("EXCLUIDO");
  if (d.status === "ARQUIVADO") m.push("ARQUIVADO");
  if (d.sensibilidade === "SIGILOSO") m.push("SIGILOSO");
  if (d.anonimizacao_status === "PENDENTE") m.push("ANONIMIZACAO_PENDENTE");
  else if (!d.documento_original_id && (d.contem_dados_pessoais || d.anonimizacao_status === "ANONIMIZADA")) m.push("DADOS_PESSOAIS");
  else if (d.documento_original_id && d.contem_dados_pessoais) m.push("DADOS_PESSOAIS");
  return m;
}
export const documentoCompartilhavel = (d: DocElegibilidade): boolean => motivosBloqueio(d).length === 0;
export const exigeConfirmacaoRestrito = (sensibilidade: GedSensibilidade): boolean => sensibilidade === "RESTRITO";

/** Espelho em Prisma de `documentoCompartilhavel` (use sempre junto de whereGedVisivel do criador). */
export function whereCompartilhavel(): Prisma.GedDocumentoWhereInput {
  return {
    excluido_em: null,
    status: { not: "ARQUIVADO" },
    sensibilidade: { not: "SIGILOSO" },
    anonimizacao_status: { not: "PENDENTE" },
    contem_dados_pessoais: false,
    OR: [{ documento_original_id: { not: null } }, { documento_original_id: null, anonimizacao_status: "NAO_NECESSARIA" }],
  };
}

// ───────────── Permissões do link ─────────────

export type PermissoesLink = { pode_visualizar: boolean; pode_baixar: boolean; pode_zip: boolean };

/** Coerência: ao menos ver ou baixar; ZIP só com baixar e só em pasta. */
export function normalizarPermissoes(p: Partial<PermissoesLink>, recurso: "DOCUMENTO" | "PASTA"): PermissoesLink | { erro: string } {
  const pode_visualizar = p.pode_visualizar ?? true;
  const pode_baixar = p.pode_baixar ?? false;
  const pode_zip = p.pode_zip ?? false;
  if (!pode_visualizar && !pode_baixar) return { erro: "Marque ao menos uma permissão: visualizar ou baixar." };
  if (pode_zip && !pode_baixar) return { erro: "Baixar a pasta em ZIP exige a permissão de baixar." };
  if (pode_zip && recurso !== "PASTA") return { erro: "O ZIP só se aplica ao compartilhamento de pasta." };
  return { pode_visualizar, pode_baixar, pode_zip };
}

export type LimiteDownload = { limite_downloads: number | null; downloads: number };
export const downloadsEsgotados = (l: LimiteDownload): boolean => l.limite_downloads !== null && l.downloads >= l.limite_downloads;

// ───────────── Sessão ─────────────

export type SessaoEstado = { expira_em: Date; teto_em: Date; encerrada_em: Date | null; ua_hash: string };
export type SituacaoSessao = "OK" | "EXPIRADA" | "ENCERRADA" | "NAVEGADOR_DIFERENTE";

export function situacaoSessao(s: SessaoEstado, uaHash: string, agora: Date): SituacaoSessao {
  if (s.encerrada_em) return "ENCERRADA";
  if (s.expira_em.getTime() <= agora.getTime() || s.teto_em.getTime() <= agora.getTime()) return "EXPIRADA";
  if (!iguaisTempoConstante(s.ua_hash, uaHash)) return "NAVEGADOR_DIFERENTE";
  return "OK";
}
/** Janela deslizante: +30 min a cada uso, nunca além do teto absoluto (2 h desde a criação). */
export const renovarSessao = (agora: Date, teto: Date): Date => new Date(Math.min(agora.getTime() + SESSAO_DESLIZANTE_MS, teto.getTime()));
export const tetoDaSessao = (criada: Date): Date => new Date(criada.getTime() + SESSAO_TETO_MS);

// ───────────── Entrada da API (zod) ─────────────

const bool = (padrao: boolean) => z.preprocess((v) => (v === "on" || v === "true" || v === true ? true : v === "false" || v === false ? false : v ?? padrao), z.boolean());
const opcional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());

export const zCriarCompartilhamento = z
  .object({
    recurso: z.discriminatedUnion("tipo", [z.object({ tipo: z.literal("documento"), id: z.string().uuid() }), z.object({ tipo: z.literal("pasta"), id: z.string().uuid() })]),
    destinatario_nome: opcional(z.string().trim().max(120)),
    whatsapp: z.string().trim().min(8, "Informe o WhatsApp do destinatário.").max(30),
    validade_dias: opcional(z.coerce.number().int("Use um número inteiro de dias.").min(1, "Mínimo de 1 dia.").max(VALIDADE_MAXIMA_DIAS, `Máximo de ${VALIDADE_MAXIMA_DIAS} dias.`)),
    pode_visualizar: bool(true),
    pode_baixar: bool(false),
    pode_zip: bool(false),
    limite_downloads: opcional(z.coerce.number().int("Use um número inteiro.").min(1, "Mínimo de 1.").max(10_000)),
    mensagem: opcional(z.string().trim().max(500)),
    confirmar_restrito: bool(false),
    congelar: bool(false),
    notificar_primeiro_acesso: opcional(bool(true)),
    enviar_link_whatsapp: bool(false),
  })
  .strict();
export type EntradaCompartilhamento = z.infer<typeof zCriarCompartilhamento>;

export const zValidarOtp = z.object({ codigo: z.string().trim().min(1).max(20) }).strict();

// ───────────── Rótulos ─────────────

export const ROTULO_STATUS_COMPARTILHAMENTO: Record<GedStatusCompartilhamento, string> = { ATIVO: "Ativo", REVOGADO: "Revogado", EXPIRADO: "Expirado" };

export type TipoEventoCompartilhamento =
  | "LINK_CRIADO" | "LINK_ENVIADO_WHATSAPP" | "OTP_ENVIADO" | "OTP_ENVIO_FALHOU" | "OTP_VALIDADO" | "OTP_FALHOU" | "OTP_BLOQUEADO"
  | "VISUALIZOU" | "BAIXOU" | "BAIXOU_ZIP" | "SESSAO_ENCERRADA" | "REVOGADO" | "EXPIRADO" | "RECURSO_EXCLUIDO" | "ACESSO_NEGADO";

export const ROTULO_EVENTO_COMPARTILHAMENTO: Record<TipoEventoCompartilhamento, string> = {
  LINK_CRIADO: "Link criado",
  LINK_ENVIADO_WHATSAPP: "Link enviado ao destinatário por WhatsApp",
  OTP_ENVIADO: "Código enviado ao WhatsApp",
  OTP_ENVIO_FALHOU: "Falha ao enviar o código",
  OTP_VALIDADO: "Código validado (acesso liberado)",
  OTP_FALHOU: "Código incorreto",
  OTP_BLOQUEADO: "Tentativas bloqueadas temporariamente",
  VISUALIZOU: "Documento visualizado",
  BAIXOU: "Documento baixado",
  BAIXOU_ZIP: "Pasta baixada em ZIP",
  SESSAO_ENCERRADA: "Sessão encerrada pelo destinatário",
  REVOGADO: "Link revogado",
  EXPIRADO: "Link expirado",
  RECURSO_EXCLUIDO: "Link revogado: o recurso foi excluído",
  ACESSO_NEGADO: "Acesso negado",
};
