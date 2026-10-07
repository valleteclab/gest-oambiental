// Regras PURAS do trâmite digital (sem banco) – testadas em tests/unit/ged-tramite.test.ts.
//
// Modelo (docs/ged-design.md §2/§7):
//  - ENVIO        move o documento: destinatário = usuário (responsavel_id) OU setor (setor_atual_id), nunca os dois.
//  - DEVOLUCAO    volta ao remetente anterior (pilha de envios, ver `resolverRemetenteAnterior`).
//  - DESPACHO     nota sem mover.
//  - CIENCIA      registro do destinatário atual; referencia_id aponta para o ENVIO que recebeu ciência.
//  - RECUSA       registrada pelo fluxo de assinatura (frente D); não move.
//  - ARQUIVAMENTO status → ARQUIVADO (destinatário atual é mantido, para não retirar o acesso de quem tem o documento).
import type { GedStatusDocumento, GedTipoTramite } from "@prisma/client";
import { invalido } from "@/lib/http";

export const MAX_DESPACHO = 4000;

export type LinhaTramite = {
  id: string;
  tipo: GedTipoTramite;
  de_usuario_id: string | null;
  de_setor_id: string | null;
  para_usuario_id: string | null;
  para_setor_id: string | null;
  referencia_id?: string | null;
};

/** Tipos que mudam o destinatário atual. */
export const TIPOS_QUE_MOVEM: readonly GedTipoTramite[] = ["ENVIO", "DEVOLUCAO"];

export const normalizarDespacho = (v: string | null | undefined): string | null => {
  const t = String(v ?? "").replace(/\r\n/g, "\n").trim();
  return t ? t : null;
};

export type EntradaValidacao = {
  tipo: GedTipoTramite;
  para_usuario_id?: string | null;
  para_setor_id?: string | null;
  despacho?: string | null;
  prazo_em?: Date | null;
  referencia_id?: string | null;
};

/** Valida a forma da entrada por tipo (lança 422). Não consulta banco. */
export function validarEntradaTramite(e: EntradaValidacao, agora: Date = new Date()): { despacho: string | null } {
  const despacho = normalizarDespacho(e.despacho);
  if (despacho && despacho.length > MAX_DESPACHO) throw invalido(`O despacho deve ter no máximo ${MAX_DESPACHO} caracteres.`);
  const temUsuario = !!e.para_usuario_id;
  const temSetor = !!e.para_setor_id;
  switch (e.tipo) {
    case "ENVIO":
      if (temUsuario === temSetor) throw invalido("Informe o destinatário: um usuário OU um setor.");
      if (e.prazo_em && e.prazo_em.getTime() < agora.getTime() - 60_000) throw invalido("O prazo deve estar no futuro.");
      break;
    case "DESPACHO":
      if (!despacho) throw invalido("Escreva o despacho.");
      if (temUsuario || temSetor || e.prazo_em) throw invalido("O despacho não move o documento: não informe destinatário nem prazo.");
      break;
    case "DEVOLUCAO":
      if (!despacho) throw invalido("Informe o motivo da devolução.");
      if (temUsuario || temSetor) throw invalido("A devolução vai sempre ao remetente anterior.");
      break;
    case "CIENCIA":
    case "ARQUIVAMENTO":
    case "RECUSA":
      if (temUsuario || temSetor) throw invalido("Este tipo de trâmite não tem destinatário.");
      if (e.prazo_em) throw invalido("Este tipo de trâmite não tem prazo.");
      break;
  }
  if (e.tipo !== "CIENCIA" && e.referencia_id) throw invalido("Somente a ciência referencia outro trâmite.");
  return { despacho };
}

/**
 * Remetente a quem devolver: percorre o histórico (ordem cronológica) mantendo a pilha de remetentes;
 * ENVIO empilha o remetente, DEVOLUCAO desempilha. Topo = remetente anterior (null se não houver).
 */
export function resolverRemetenteAnterior(historico: readonly LinhaTramite[]): { usuario_id: string | null; setor_id: string | null; envio_id: string } | null {
  const pilha: { usuario_id: string | null; setor_id: string | null; envio_id: string }[] = [];
  for (const l of historico) {
    if (l.tipo === "ENVIO") pilha.push({ usuario_id: l.de_usuario_id, setor_id: l.de_setor_id, envio_id: l.id });
    else if (l.tipo === "DEVOLUCAO") pilha.pop();
  }
  const topo = pilha[pilha.length - 1];
  return topo && (topo.usuario_id || topo.setor_id) ? topo : null;
}

/** Quem detém o documento agora (para decidir ciência/devolução). */
export type Posse = { responsavel_id: string | null; setor_atual_id: string | null };

export const ehDestinatarioAtual = (posse: Posse, usuarioId: string, setorIds: readonly string[]): boolean =>
  posse.responsavel_id === usuarioId || (posse.setor_atual_id !== null && setorIds.includes(posse.setor_atual_id));

/** Nova posse após um trâmite que move (ENVIO/DEVOLUCAO). */
export function novaPosse(para: { usuario_id: string | null; setor_id: string | null }, tipo: GedTipoTramite, atual: Posse): Posse {
  if (!TIPOS_QUE_MOVEM.includes(tipo)) return atual;
  // Envio a usuário zera o setor; envio a setor zera o responsável. Devolução restaura o par do remetente.
  return { responsavel_id: para.usuario_id, setor_atual_id: para.setor_id };
}

/** Status do documento após o trâmite (só ARQUIVAMENTO altera). */
export function statusAposTramite(tipo: GedTipoTramite, atual: GedStatusDocumento): GedStatusDocumento {
  return tipo === "ARQUIVAMENTO" ? "ARQUIVADO" : atual;
}

/** O documento aceita o trâmite neste status? (lança 422) */
export function exigirStatusPermite(tipo: GedTipoTramite, status: GedStatusDocumento): void {
  if (tipo === "RECUSA") return; // frente D controla o próprio ciclo
  if (status === "ARQUIVADO") throw invalido("Documento arquivado: não admite novos trâmites.");
  if (tipo === "ARQUIVAMENTO" && status === "EM_ASSINATURA") throw invalido("Documento em assinatura: conclua ou cancele a assinatura antes de arquivar.");
}

/** ENVIO (id) ainda sem ciência, dado o histórico. */
export function enviosSemCiencia(historico: readonly LinhaTramite[]): LinhaTramite[] {
  const dadas = new Set(historico.filter((l) => l.tipo === "CIENCIA" && l.referencia_id).map((l) => l.referencia_id!));
  return historico.filter((l) => l.tipo === "ENVIO" && !dadas.has(l.id));
}

/**
 * ENVIO que o destinatário atual deve ciência: o mais recente destinado a mim/meus setores (ou do tipo DEVOLUCAO
 * que me devolveu o documento); null se não houver. Considera ENVIO e DEVOLUCAO como "entrega".
 */
export function entregaMaisRecente(historico: readonly LinhaTramite[], usuarioId: string, setorIds: readonly string[]): LinhaTramite | null {
  for (let i = historico.length - 1; i >= 0; i--) {
    const l = historico[i];
    if (!TIPOS_QUE_MOVEM.includes(l.tipo)) continue;
    if (l.para_usuario_id === usuarioId || (l.para_setor_id !== null && setorIds.includes(l.para_setor_id))) return l;
  }
  return null;
}

/** dd/mm/aaaa HH:mm em Brasília (America/Bahia = UTC-3 sem horário de verão). */
export function fmtDataHoraBR(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(d))
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Cor do selo por tipo (timeline). */
export const COR_TIPO_TRAMITE: Record<GedTipoTramite, "azul" | "cinza" | "verde" | "amarelo" | "vermelho" | "roxo"> = {
  ENVIO: "azul",
  DESPACHO: "cinza",
  CIENCIA: "verde",
  DEVOLUCAO: "amarelo",
  RECUSA: "vermelho",
  ARQUIVAMENTO: "roxo",
};
