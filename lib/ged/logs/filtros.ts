// Filtros e consultas PURAS dos logs do GED (período, usuário, documento, ação/canal/status): lê searchParams e monta os `where`
// do Prisma. Sem banco – testado em tests/unit/ged-logs.test.ts. O escopo do cliente NÃO é responsabilidade daqui:
// gedDb() injeta organizacao_id nos modelos Ged*; LogAuditoria (não é Ged*) recebe organizacao_id explicitamente em `whereAlteracoes`.
import type { GedCanalCom, GedStatusCom, Prisma } from "@prisma/client";

export type AbaLogs = "acessos" | "alteracoes" | "comunicacoes";
export const ABAS_LOGS: readonly AbaLogs[] = ["acessos", "alteracoes", "comunicacoes"];
export const TAMANHO_PAGINA_LOGS = 25;

export const ACOES_ACESSO = ["VISUALIZAR", "BAIXAR", "BUSCAR", "LISTAR", "NEGADO", "LOGIN_GED"] as const;
export const CANAIS_COM: readonly GedCanalCom[] = ["EMAIL", "WHATSAPP"];
export const STATUS_COM: readonly GedStatusCom[] = ["PENDENTE", "ENVIADA", "SIMULADA", "ERRO", "IGNORADA"];

export type FiltrosLogs = {
  aba: AbaLogs;
  de: string | null; // YYYY-MM-DD (Brasília)
  ate: string | null;
  usuario_id: string | null;
  /** Id (uuid) ou parte do número do documento. */
  documento: string | null;
  acao: string | null;
  canal: GedCanalCom | null;
  status: GedStatusCom | null;
  evento: string | null;
  page: number;
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
export const ehUuidLog = (v: string) => RE_UUID.test(v);

type SP = Record<string, string | string[] | undefined>;
const um = (sp: SP, k: string): string | null => {
  const v = sp[k];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim().slice(0, 120) : null;
};

/** Dia civil válido (YYYY-MM-DD) ou null. */
function dia(v: string | null): string | null {
  if (!v || !RE_DIA.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export function lerFiltros(sp: SP): FiltrosLogs {
  const aba = um(sp, "aba");
  const canal = um(sp, "canal");
  const status = um(sp, "status");
  const usuario = um(sp, "usuario");
  const pagina = Number(um(sp, "page") ?? 1);
  return {
    aba: (ABAS_LOGS as readonly string[]).includes(aba ?? "") ? (aba as AbaLogs) : "acessos",
    de: dia(um(sp, "de")),
    ate: dia(um(sp, "ate")),
    usuario_id: usuario && RE_UUID.test(usuario) ? usuario : null,
    documento: um(sp, "documento"),
    acao: um(sp, "acao"),
    canal: (CANAIS_COM as readonly string[]).includes(canal ?? "") ? (canal as GedCanalCom) : null,
    status: (STATUS_COM as readonly string[]).includes(status ?? "") ? (status as GedStatusCom) : null,
    evento: um(sp, "evento"),
    page: Number.isFinite(pagina) && pagina >= 1 ? Math.min(Math.floor(pagina), 100000) : 1,
  };
}

/** Intervalo [de 00:00, ate+1 00:00) em horário de Brasília (UTC−3, sem horário de verão). */
export function intervaloPeriodo(f: Pick<FiltrosLogs, "de" | "ate">): { gte?: Date; lt?: Date } {
  const r: { gte?: Date; lt?: Date } = {};
  if (f.de) r.gte = new Date(`${f.de}T00:00:00-03:00`);
  if (f.ate) r.lt = new Date(new Date(`${f.ate}T00:00:00-03:00`).getTime() + 24 * 3600_000);
  return r;
}

const periodo = (f: FiltrosLogs) => {
  const p = intervaloPeriodo(f);
  return p.gte || p.lt ? { created_at: p } : {};
};

/** Resolve o filtro "documento": id exato ou lista de ids já encontrados pelo número (o chamador faz a busca). */
export type AlvoDocumento = { ids: string[] } | null;
export const documentoEhId = (f: Pick<FiltrosLogs, "documento">) => !!f.documento && RE_UUID.test(f.documento);

const filtroDoc = (alvo: AlvoDocumento): Prisma.GedAcessoLogWhereInput => (alvo ? { documento_id: { in: alvo.ids } } : {});

export function whereAcessos(f: FiltrosLogs, alvo: AlvoDocumento): Prisma.GedAcessoLogWhereInput {
  return {
    ...periodo(f),
    ...(f.usuario_id ? { usuario_id: f.usuario_id } : {}),
    ...(f.acao && (ACOES_ACESSO as readonly string[]).includes(f.acao) ? { acao: f.acao } : {}),
    ...filtroDoc(alvo),
  };
}

export function whereComunicacoes(f: FiltrosLogs, alvo: AlvoDocumento): Prisma.GedComunicacaoWhereInput {
  return {
    ...periodo(f),
    ...(f.usuario_id ? { usuario_id: f.usuario_id } : {}),
    ...(f.canal ? { canal: f.canal } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.evento ? { evento: f.evento } : {}),
    ...(alvo ? { documento_id: { in: alvo.ids } } : {}),
  };
}

/** Condição "este registro de auditoria é sobre algum destes documentos" (entidade_id ou documento_id no antes/depois). */
export function condicaoDocumentoAuditoria(ids: string[]): Prisma.LogAuditoriaWhereInput {
  return {
    OR: [
      { entidade_id: { in: ids } },
      ...ids.slice(0, 20).flatMap((id): Prisma.LogAuditoriaWhereInput[] => [{ depois: { path: ["documento_id"], equals: id } }, { antes: { path: ["documento_id"], equals: id } }]),
    ],
  };
}

/** Alterações = LogAuditoria da organização cujas entidades começam com "ged" (ged_documento, ged_acl, ged_setor, …). */
export function whereAlteracoes(organizacaoId: string, f: FiltrosLogs, alvo: AlvoDocumento): Prisma.LogAuditoriaWhereInput {
  const and: Prisma.LogAuditoriaWhereInput[] = [{ organizacao_id: organizacaoId }, { entidade: { startsWith: "ged", mode: "insensitive" } }];
  const p = intervaloPeriodo(f);
  if (p.gte || p.lt) and.push({ created_at: p });
  if (f.usuario_id) and.push({ usuario_id: f.usuario_id });
  if (f.acao) and.push({ acao: { contains: f.acao.replace(/[^\w]/g, ""), mode: "insensitive" } });
  if (alvo) and.push(alvo.ids.length ? condicaoDocumentoAuditoria(alvo.ids) : { id: { in: [] } });
  return { AND: and };
}

/** Querystring que preserva os filtros (para paginação e exportação). */
export function paramsDosFiltros(f: FiltrosLogs, extra: Record<string, string | number | null> = {}): string {
  const q = new URLSearchParams();
  q.set("aba", f.aba);
  for (const [k, v] of Object.entries({ de: f.de, ate: f.ate, usuario: f.usuario_id, documento: f.documento, acao: f.acao, canal: f.canal, status: f.status, evento: f.evento })) if (v) q.set(k, v);
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined) q.set(k, String(v));
  return q.toString();
}
