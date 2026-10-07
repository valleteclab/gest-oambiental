// Regras puras do módulo de Fiscalização (SPEC 5.5 / 8) – sem dependências de servidor,
// podem ser usadas em componentes cliente e testadas em tests/unit/fiscalizacao*.test.ts.
import type { CanalDenuncia, Constatacao, OrigemFiscalizacao, Penalidade, StatusAuto, StatusDenuncia, StatusNotificacao } from "@prisma/client";
import { can, isSomenteLeitura, type UsuarioSessao } from "../rbac";

// ───────────── Rótulos e cores ─────────────
export const ROTULO_STATUS_DENUNCIA: Record<StatusDenuncia, string> = { NOVA: "Nova", EM_APURACAO: "Em apuração", CONCLUIDA: "Concluída", ARQUIVADA: "Arquivada" };
export const ROTULO_CANAL: Record<CanalDenuncia, string> = { PORTAL: "Portal", PRESENCIAL: "Presencial", TELEFONE: "Telefone", OUTRO: "Outro", WHATSAPP: "WhatsApp", CHAT_SITE: "Chat do site", EMAIL: "E-mail" };
export const ROTULO_CONSTATACAO: Record<Constatacao, string> = { IRREGULAR: "Irregular", REGULAR: "Regular", INCONCLUSIVA: "Inconclusiva" };
export const ROTULO_ORIGEM: Record<OrigemFiscalizacao, string> = { DENUNCIA: "Denúncia", PROCESSO: "Processo", ROTINA: "Rotina" };
export const ROTULO_PENALIDADE: Record<Penalidade, string> = { ADVERTENCIA: "Advertência", MULTA: "Multa", EMBARGO: "Embargo", INTERDICAO: "Interdição", OUTRA: "Outra" };
export const ROTULO_STATUS_AUTO: Record<StatusAuto, string> = { LAVRADO: "Lavrado", EM_DEFESA: "Em defesa", JULGADO: "Julgado", PAGO: "Pago", CANCELADO: "Cancelado" };
export const ROTULO_STATUS_NOTIFICACAO: Record<StatusNotificacao, string> = { EMITIDA: "Emitida", ATENDIDA: "Atendida", VENCIDA: "Vencida", CANCELADA: "Cancelada" };

type CorBadge = "verde" | "amarelo" | "vermelho" | "azul" | "cinza" | "roxo";
export const COR_BADGE_DENUNCIA: Record<StatusDenuncia, CorBadge> = { NOVA: "vermelho", EM_APURACAO: "amarelo", CONCLUIDA: "verde", ARQUIVADA: "cinza" };
export const COR_BADGE_CONSTATACAO: Record<Constatacao, CorBadge> = { IRREGULAR: "vermelho", REGULAR: "verde", INCONCLUSIVA: "amarelo" };

/** Cores dos pins no mapa (hex). */
export const COR_PIN_CONSTATACAO: Record<Constatacao | "SEM", string> = { IRREGULAR: "#b91c1c", REGULAR: "#047857", INCONCLUSIVA: "#d97706", SEM: "#475569" };
export const COR_PIN_DENUNCIA: Record<StatusDenuncia, string> = { NOVA: "#7c3aed", EM_APURACAO: "#2563eb", CONCLUIDA: "#0891b2", ARQUIVADA: "#94a3b8" };

// ───────────── Permissões ─────────────
/** Registrar vistoria / denúncia interna: FISCAL, técnicos e ADMIN (SEMA_INEMA e GESTOR não). */
export const podeRegistrarVistoria = (u: UsuarioSessao, municipioId?: string | null) => !isSomenteLeitura(u) && can(u, "criar", "fiscalizacao", municipioId);
/** Lavrar auto / notificação e gerar PDF: FISCAL, técnicos, ADMIN e GESTOR. */
export const podeEmitirFiscalizacao = (u: UsuarioSessao, municipioId?: string | null) => !isSomenteLeitura(u) && can(u, "emitir_documento", "fiscalizacao", municipioId);
export const podeEditarDenuncia = (u: UsuarioSessao, municipioId?: string | null) => !isSomenteLeitura(u) && can(u, "editar", "denuncia", municipioId);
export const podeCriarDenuncia = (u: UsuarioSessao, municipioId?: string | null) => !isSomenteLeitura(u) && can(u, "criar", "denuncia", municipioId);

// ───────────── Regras de negócio ─────────────
export function origemFiscalizacao(p: { denuncia_id?: string | null; processo_id?: string | null }): OrigemFiscalizacao {
  if (p.denuncia_id) return "DENUNCIA";
  if (p.processo_id) return "PROCESSO";
  return "ROTINA";
}

/** Transições permitidas de status da denúncia (NOVA → EM_APURACAO → CONCLUIDA/ARQUIVADA; reabrir para EM_APURACAO). */
export const TRANSICOES_DENUNCIA: Record<StatusDenuncia, StatusDenuncia[]> = {
  NOVA: ["EM_APURACAO", "ARQUIVADA"],
  EM_APURACAO: ["CONCLUIDA", "ARQUIVADA"],
  CONCLUIDA: ["EM_APURACAO"],
  ARQUIVADA: ["EM_APURACAO"],
};
export const podeTransicionarDenuncia = (de: StatusDenuncia, para: StatusDenuncia) => TRANSICOES_DENUNCIA[de].includes(para);

/** Prazo da notificação: dias corridos a partir da emissão, até o fim do dia. */
export function prazoAteNotificacao(prazoDias: number, inicio = new Date()): Date {
  const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + prazoDias, 23, 59, 59);
  return d;
}

// ───────────── Imagens (compressão no cliente) ─────────────
export const LIMITE_FOTO = 1.5 * 1024 * 1024; // 1,5 MB (SPEC 8)
export const LIMITE_FOTO_SERVIDOR = 5 * 1024 * 1024; // tolerância no servidor
export const MAX_FOTOS = 20;

/** Dimensões finais mantendo proporção, limitadas ao maior lado `maxLado`. */
export function dimensoesReduzidas(largura: number, altura: number, maxLado: number): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= maxLado) return { largura, altura };
  const f = maxLado / maior;
  return { largura: Math.round(largura * f), altura: Math.round(altura * f) };
}

/** Mantém o arquivo original (preserva EXIF) quando já é JPEG/PNG e cabe no limite. */
export const manterOriginal = (mime: string, tamanho: number) => (mime === "image/jpeg" || mime === "image/png") && tamanho <= LIMITE_FOTO;

/** Detecta JPEG/PNG pelos bytes mágicos (não confia no mime enviado). */
export function tipoImagem(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

/** Valor monetário digitado ("1.234,56", "1234.56", "R$ 500") → número; null se vazio, NaN se inválido. */
export function lerMoeda(v: string): number | null {
  const t = (v ?? "").replace(/[^\d,.-]/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t);
  return Number.isFinite(n) ? n : NaN;
}
