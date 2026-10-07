import "server-only";
import type { Prisma, StatusCobranca } from "@prisma/client";
import { prisma } from "../db";
import { isInterno, whereMunicipio, whereProcessoEscopo, type UsuarioSessao } from "../rbac";
import { UUID_RE } from "../processo/consultas";

// Listagem de cobranças SEMPRE com escopo por município (whereMunicipio) – /financeiro e GET /api/v1/cobrancas.

export const STATUS_COBRANCA: StatusCobranca[] = ["PENDENTE", "PAGA", "VENCIDA", "CANCELADA", "ESTORNADA", "ISENTA"];

export type FiltroCobrancas = {
  municipio?: string | null;
  status?: string | null;
  fase?: string | null;
  /** Período (data de criação da cobrança), YYYY-MM-DD */
  de?: string | null;
  ate?: string | null;
  q?: string | null;
  processo?: string | null;
};

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtro base (sem status) – usado também nos totais. */
function whereBase(u: UsuarioSessao, f: FiltroCobrancas): Prisma.CobrancaWhereInput {
  // Interno: municípios do escopo; requerente: cobranças dos processos de que é titular (requerente/RT).
  const escopo: Prisma.CobrancaWhereInput = isInterno(u) ? whereMunicipio(u, f.municipio && UUID_RE.test(f.municipio) ? f.municipio : null) : { processo: whereProcessoEscopo(u) as Prisma.ProcessoWhereInput };
  const and: Prisma.CobrancaWhereInput[] = [escopo];
  if (f.fase && ["UNICA", "ANALISE", "VISTORIA", "EMISSAO"].includes(f.fase)) and.push({ fase: f.fase as Prisma.CobrancaWhereInput["fase"] });
  if (f.de && DATA_RE.test(f.de)) and.push({ created_at: { gte: new Date(`${f.de}T00:00:00-03:00`) } });
  if (f.ate && DATA_RE.test(f.ate)) and.push({ created_at: { lte: new Date(`${f.ate}T23:59:59.999-03:00`) } });
  if (f.processo && UUID_RE.test(f.processo)) and.push({ processo_id: f.processo });
  const q = f.q?.trim();
  if (q) and.push({ OR: [{ numero: { contains: q, mode: "insensitive" } }, { processo: { numero: { contains: q, mode: "insensitive" } } }, { descricao: { contains: q, mode: "insensitive" } }] });
  return { AND: and };
}

export function whereCobrancas(u: UsuarioSessao, f: FiltroCobrancas): Prisma.CobrancaWhereInput {
  const base = whereBase(u, f);
  return f.status && STATUS_COBRANCA.includes(f.status as StatusCobranca) ? { AND: [base, { status: f.status as StatusCobranca }] } : base;
}

export const SELECT_LISTA = {
  id: true,
  numero: true,
  fase: true,
  descricao: true,
  valor: true,
  vencimento: true,
  status: true,
  gateway: true,
  asaas_payment_id: true,
  invoice_url: true,
  pago_em: true,
  valor_pago: true,
  forma_pagamento: true,
  baixa_manual: true,
  erro_gateway: true,
  created_at: true,
  municipio: { select: { id: true, nome: true, sigla: true } },
  processo: { select: { id: true, numero: true, requerente: { select: { nome: true } } } },
} satisfies Prisma.CobrancaSelect;

export type Totais = { arrecadado: number; pendente: number; vencido: number; isento: number; quantidade: Record<StatusCobranca, number> };

export async function listarCobrancas(u: UsuarioSessao, f: FiltroCobrancas, pg: { skip: number; take: number }) {
  const where = whereCobrancas(u, f);
  const [total, itens, grupos] = await Promise.all([
    prisma.cobranca.count({ where }),
    prisma.cobranca.findMany({ where, select: SELECT_LISTA, orderBy: [{ created_at: "desc" }], skip: pg.skip, take: pg.take }),
    prisma.cobranca.groupBy({ by: ["status"], where: whereBase(u, f), _sum: { valor: true, valor_pago: true }, _count: { _all: true } }),
  ]);
  const soma = (s: StatusCobranca, campo: "valor" | "valor_pago") => Number(grupos.find((g) => g.status === s)?._sum[campo]?.toString() ?? 0);
  const totais: Totais = {
    arrecadado: soma("PAGA", "valor_pago"),
    pendente: soma("PENDENTE", "valor"),
    vencido: soma("VENCIDA", "valor"),
    isento: soma("ISENTA", "valor"),
    quantidade: Object.fromEntries(STATUS_COBRANCA.map((s) => [s, grupos.find((g) => g.status === s)?._count._all ?? 0])) as Record<StatusCobranca, number>,
  };
  return { total, itens, totais };
}

/** Serialização para a API (sem QR em base64 na lista; nunca expõe dados da conta Asaas). */
export function cobrancaParaApi(c: Record<string, unknown>) {
  const resto = { ...c };
  delete resto.asaas_customer_id;
  delete resto.comprovante_key;
  return { ...resto, simulada: typeof c.asaas_payment_id === "string" && c.asaas_payment_id.startsWith("sim_"), tem_comprovante: !!c.comprovante_key };
}
