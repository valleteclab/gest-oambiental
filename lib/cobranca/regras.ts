// Cobrança de taxas de licenciamento – regras PURAS (sem banco/HTTP), cobertas por tests/unit/cobranca.test.ts.
// Serviços com banco/gateway: ./servico.ts (docs/cobranca.md).
import type { FaseCobranca, PotencialPoluidor, Porte, StatusCobranca } from "@prisma/client";

export const FASES: FaseCobranca[] = ["UNICA", "ANALISE", "VISTORIA", "EMISSAO"];

export const ROTULO_FASE: Record<FaseCobranca, string> = {
  UNICA: "taxa única",
  ANALISE: "análise",
  VISTORIA: "vistoria",
  EMISSAO: "emissão",
};

/** Rótulo com inicial maiúscula ("Taxa de análise", "Taxa única"). */
export function rotuloTaxa(f: FaseCobranca): string {
  return f === "UNICA" ? "Taxa única" : `Taxa de ${ROTULO_FASE[f]}`;
}

export const ROTULO_STATUS_COBRANCA: Record<StatusCobranca, string> = {
  PENDENTE: "Pendente",
  PAGA: "Paga",
  VENCIDA: "Vencida",
  CANCELADA: "Cancelada",
  ESTORNADA: "Estornada",
  ISENTA: "Isenta",
};

export const COR_STATUS_COBRANCA: Record<StatusCobranca, "verde" | "amarelo" | "vermelho" | "azul" | "cinza" | "roxo"> = {
  PENDENTE: "amarelo",
  PAGA: "verde",
  VENCIDA: "vermelho",
  CANCELADA: "cinza",
  ESTORNADA: "roxo",
  ISENTA: "azul",
};

export const ROTULO_FORMA: Record<string, string> = { PIX: "Pix", BOLETO: "boleto", CREDIT_CARD: "cartão de crédito", DEBIT_CARD: "cartão de débito", UNDEFINED: "Pix/boleto", MANUAL: "baixa manual", SIMULADO: "simulação de homologação", DINHEIRO: "dinheiro", TRANSFERENCIA: "transferência", DAM: "guia (DAM)" };
export const rotuloForma = (f: string | null | undefined) => (f ? ROTULO_FORMA[f] ?? f.toLowerCase() : "—");

/** Status que ainda podem ser pagos (bloqueiam a etapa quando o município exige o pagamento). */
export const STATUS_EM_ABERTO: StatusCobranca[] = ["PENDENTE", "VENCIDA"];
/** Status que quitam a cobrança. */
export const STATUS_QUITADOS: StatusCobranca[] = ["PAGA", "ISENTA"];

// ───────────── Tabela de taxas: a linha mais específica vence ─────────────

export type LinhaTaxa = {
  id: string;
  municipio_id: string | null;
  tipo_ato_id: string | null;
  fase: FaseCobranca;
  porte: Porte | null;
  potencial: PotencialPoluidor | null;
  valor: number | string | { toString(): string };
  ativo: boolean;
  descricao?: string | null;
  base_legal?: string | null;
  created_at?: Date;
};

export type ProcessoTaxa = { municipio_id: string; tipo_ato_id: string; porte: Porte | null; potencial: PotencialPoluidor | null };

/** Pontuação de especificidade: município > tipo de ato > porte/potencial (cada nível domina os seguintes). */
export function especificidade(l: Pick<LinhaTaxa, "municipio_id" | "tipo_ato_id" | "porte" | "potencial">): number {
  return (l.municipio_id ? 100 : 0) + (l.tipo_ato_id ? 10 : 0) + (l.porte ? 1 : 0) + (l.potencial ? 1 : 0);
}

/**
 * Linha da tabela aplicável ao processo na fase (null = sem taxa). Critérios: ativa, mesma fase e cada coluna
 * preenchida igual à do processo (nula = "qualquer"). Entre as candidatas vence a mais específica
 * (município > organização; tipo de ato definido > nulo; porte/potencial definidos > nulos); empate → a mais recente.
 */
export function calcularTaxa<T extends LinhaTaxa>(linhas: T[], p: ProcessoTaxa, fase: FaseCobranca): T | null {
  const candidatas = linhas.filter(
    (l) =>
      l.ativo &&
      l.fase === fase &&
      (!l.municipio_id || l.municipio_id === p.municipio_id) &&
      (!l.tipo_ato_id || l.tipo_ato_id === p.tipo_ato_id) &&
      (!l.porte || l.porte === p.porte) &&
      (!l.potencial || l.potencial === p.potencial) &&
      Number(l.valor.toString()) > 0,
  );
  if (!candidatas.length) return null;
  return [...candidatas].sort((a, b) => especificidade(b) - especificidade(a) || (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0))[0];
}

/** Fase cobrada no protocolo: taxa ÚNICA tem precedência sobre a de análise. */
export function faseDoProtocolo(linhas: LinhaTaxa[], p: ProcessoTaxa): { fase: FaseCobranca; linha: LinhaTaxa } | null {
  for (const fase of ["UNICA", "ANALISE"] as const) {
    const linha = calcularTaxa(linhas, p, fase);
    if (linha) return { fase, linha };
  }
  return null;
}

// ───────────── Gatilhos no fluxo do processo ─────────────

/** Fases cujo pagamento em aberto bloqueia a ação (quando config.exige_pagamento). */
export function fasesQueBloqueiam(acao: string): FaseCobranca[] {
  switch (acao) {
    case "aceitar":
      return ["UNICA", "ANALISE"];
    case "concluir_vistoria":
      return ["VISTORIA"];
    case "emitir_documento":
      return ["EMISSAO"];
    default:
      return [];
  }
}

/** Fase gerada pela ação (protocolar decide entre UNICA/ANALISE pela tabela). */
export function faseGeradaPor(acao: string, opts: { demandaUrbana?: boolean; temUnica?: boolean } = {}): "PROTOCOLO" | FaseCobranca | null {
  if (acao === "protocolar") return "PROTOCOLO";
  if (opts.temUnica) return null; // taxa única cobre o processo inteiro
  if (acao === "agendar_vistoria") return opts.demandaUrbana ? null : "VISTORIA"; // demandas urbanas: vistoria faz parte do fluxo simplificado
  if (acao === "deferir") return "EMISSAO";
  return null;
}

/** Mensagem de bloqueio exibida ao servidor. */
export function mensagemBloqueio(c: { fase: FaseCobranca; numero: string | null; vencimento: Date }): string {
  return `Aguardando pagamento da ${rotuloTaxa(c.fase).toLowerCase()}${c.numero ? ` (${c.numero})` : ""}. A etapa seguinte é liberada após a confirmação do pagamento, a baixa manual ou a isenção.`;
}

/** valor_taxa (soma das não canceladas) e taxa_paga (todas as devidas quitadas) do processo. */
export function resumoTaxas(cobrancas: { status: StatusCobranca; valor: number | string | { toString(): string } }[]): { valor_taxa: number | null; taxa_paga: boolean } {
  const devidas = cobrancas.filter((c) => c.status !== "CANCELADA");
  if (!devidas.length) return { valor_taxa: null, taxa_paga: false };
  const total = devidas.reduce((s, c) => s + Number(c.valor.toString()), 0);
  return { valor_taxa: Math.round(total * 100) / 100, taxa_paga: devidas.every((c) => STATUS_QUITADOS.includes(c.status)) };
}

// ───────────── Datas ─────────────

/** Data (YYYY-MM-DD, fuso America/Bahia) de hoje + n dias corridos. */
export function dataVencimento(dias: number, base = new Date()): string {
  const d = new Date(base.getTime() + dias * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Bahia" });
}

/** YYYY-MM-DD → Date (meio-dia UTC, seguro para colunas @db.Date). */
export const dataIso = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`);

/** A cobrança em aberto já passou do vencimento? (vence no fim do dia do vencimento) */
export function venceu(vencimento: Date, agora = new Date()): boolean {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Bahia" });
  return vencimento.toISOString().slice(0, 10) < hoje;
}

// ───────────── Asaas ─────────────

/** Chave de homologação (sandbox) do Asaas: prefixo `$aact_hmlg_` / `_hmlg_`. */
export const chaveSandbox = (chave: string) => chave.includes("_hmlg_");

/** Nunca devolver a chave: só os 4 últimos caracteres. */
export function mascararChave(chave: string | null | undefined): string | null {
  if (!chave) return null;
  return `••••${chave.slice(-4)}`;
}

/** Status de pagamento Asaas → status da cobrança (null = não altera). */
export function statusDoAsaas(status: string | null | undefined, deleted = false): StatusCobranca | null {
  if (deleted) return "CANCELADA";
  switch (status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
    case "DUNNING_RECEIVED":
      return "PAGA";
    case "OVERDUE":
      return "VENCIDA";
    case "REFUNDED":
      return "ESTORNADA";
    case "PENDING":
      return "PENDENTE";
    default:
      return null;
  }
}

/** Evento de webhook Asaas → status da cobrança (null = ignorado). */
export function statusDoEvento(evento: string): StatusCobranca | null {
  switch (evento) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED":
      return "PAGA";
    case "PAYMENT_OVERDUE":
      return "VENCIDA";
    case "PAYMENT_DELETED":
      return "CANCELADA";
    case "PAYMENT_REFUNDED":
      return "ESTORNADA";
    case "PAYMENT_RESTORED":
      return "PENDENTE";
    default:
      return null;
  }
}

export type PagamentoAsaas = {
  id: string;
  status?: string | null;
  value?: number | null;
  netValue?: number | null;
  billingType?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  dueDate?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  externalReference?: string | null;
  deleted?: boolean | null;
};

export type EventoAsaas = { id: string | null; evento: string; pagamento: PagamentoAsaas };

/** Lê o corpo do webhook do Asaas ({id?, event, payment:{…}}). null se não for evento de pagamento. */
export function lerEventoAsaas(corpo: unknown): EventoAsaas | null {
  if (!corpo || typeof corpo !== "object") return null;
  const o = corpo as Record<string, unknown>;
  const evento = typeof o.event === "string" ? o.event : "";
  const pay = o.payment as Record<string, unknown> | undefined;
  if (!evento.startsWith("PAYMENT_") || !pay || typeof pay.id !== "string" || !pay.id) return null;
  const s = (k: string) => (typeof pay[k] === "string" ? (pay[k] as string) : null);
  const n = (k: string) => (typeof pay[k] === "number" ? (pay[k] as number) : null);
  return {
    id: typeof o.id === "string" ? o.id : null,
    evento,
    pagamento: {
      id: pay.id,
      status: s("status"),
      value: n("value"),
      netValue: n("netValue"),
      billingType: s("billingType"),
      paymentDate: s("paymentDate"),
      clientPaymentDate: s("clientPaymentDate"),
      confirmedDate: s("confirmedDate"),
      dueDate: s("dueDate"),
      invoiceUrl: s("invoiceUrl"),
      bankSlipUrl: s("bankSlipUrl"),
      externalReference: s("externalReference"),
      deleted: pay.deleted === true,
    },
  };
}

export type Transicao = { para: StatusCobranca; pagamento: boolean };

/**
 * Decide a mudança de status da cobrança diante de um novo status (webhook ou consulta). Idempotente:
 * null quando nada muda. Regras: quitada (PAGA/ISENTA) só sai para ESTORNADA; CANCELADA/ESTORNADA são finais
 * (exceto pagamento confirmado depois de cancelada localmente – o dinheiro entrou, registra PAGA).
 */
export function decidirTransicao(atual: StatusCobranca, novo: StatusCobranca | null): Transicao | null {
  if (!novo || novo === atual) return null;
  if (atual === "ISENTA") return null;
  if (atual === "PAGA") return novo === "ESTORNADA" ? { para: "ESTORNADA", pagamento: false } : null;
  if (atual === "ESTORNADA") return null;
  if (atual === "CANCELADA") return novo === "PAGA" ? { para: "PAGA", pagamento: true } : null;
  // PENDENTE / VENCIDA
  if (novo === "PAGA") return { para: "PAGA", pagamento: true };
  if (novo === "VENCIDA" && atual === "PENDENTE") return { para: "VENCIDA", pagamento: false };
  if (novo === "PENDENTE" && atual === "VENCIDA") return { para: "PENDENTE", pagamento: false };
  if (novo === "CANCELADA") return { para: "CANCELADA", pagamento: false };
  if (novo === "ESTORNADA") return null;
  return null;
}

/** Forma de pagamento a partir do billingType do Asaas. */
export function formaDoAsaas(billingType: string | null | undefined): string {
  if (billingType === "PIX" || billingType === "BOLETO" || billingType === "CREDIT_CARD" || billingType === "DEBIT_CARD") return billingType;
  return "UNDEFINED";
}

/** Data de pagamento informada pelo Asaas (clientPaymentDate > paymentDate > confirmedDate) ou agora. */
export function dataPagamento(p: PagamentoAsaas, agora = new Date()): Date {
  const d = p.clientPaymentDate ?? p.paymentDate ?? p.confirmedDate;
  return d ? dataIso(d) : agora;
}

// ───────────── Homologação (sem gateway real) ─────────────

export const PREFIXO_SIMULADO = "sim_";
export const ehSimulada = (asaasPaymentId: string | null | undefined) => !!asaasPaymentId?.startsWith(PREFIXO_SIMULADO);

/** Código "Pix copia e cola" FICTÍCIO, claramente marcado (não é um BR Code válido – não pagar). */
export function pixSimulado(numero: string, valor: number): string {
  return `SIMULACAO-HOMOLOGACAO-LICENCIAGOV|NAO-PAGAR|${numero}|R$${valor.toFixed(2)}`;
}

/** Linha digitável FICTÍCIA (zeros) para homologação. */
export const LINHA_SIMULADA = "00000.00000 00000.000000 00000.000000 0 00000000000000";
