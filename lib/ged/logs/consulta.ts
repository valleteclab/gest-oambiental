// Consulta dos logs do GED (item 11): acessos, alterações (auditoria) e comunicações, sempre do cliente da sessão.
//  - GedAcessoLog/GedComunicacao: escopo automático de ctx.db; LogAuditoria (não é Ged*): organizacao_id explícito em whereAlteracoes().
//  - Quem pode: GED_ADMIN/GED_AUDITOR (podeVerLogs). No documento: também quem tem ADMINISTRAR nele.
//  - A lista mostra o NÚMERO do documento, nunca o título (documento sigiloso não vaza título pelo log).
import { proibido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../escopo";
import { podeVerLogs } from "../papeis";
import { ROTULO_EVENTO } from "../notificar/regras";
import { ROTULO_EVENTO_PROTOCOLO } from "../protocolo/templates";
import { BOM_UTF8, linhaCsv } from "./csv";
import {
  documentoEhId, paramsDosFiltros, TAMANHO_PAGINA_LOGS, whereAcessos, whereAlteracoes, whereComunicacoes, type AlvoDocumento, type FiltrosLogs,
} from "./filtros";
import { resumirJson, type CampoResumo } from "./resumo-json";

export type LinhaAcesso = { id: string; quando: Date; usuario: string | null; acao: string; documento_id: string | null; documento_numero: string | null; ip: string | null };
export type LinhaAlteracao = { id: string; quando: Date; usuario: string | null; acao: string; entidade: string; entidade_id: string | null; antes: CampoResumo[]; depois: CampoResumo[] };
export type LinhaComunicacao = {
  id: string; quando: Date; enviado_em: Date | null; canal: string; destinatario_mascarado: string; evento: string; evento_rotulo: string; status: string; erro: string | null;
  usuario: string | null; documento_id: string | null; documento_numero: string | null;
};
export type Pagina<T> = { total: number; itens: T[]; page: number; size: number };

export function exigirLogs(ctx: CtxGed) {
  if (!podeVerLogs(ctx)) throw proibido("Somente administradores e auditores consultam os logs.");
}

/** Documento do filtro: id exato ou os (até 50) documentos cujo NÚMERO contém o texto. null = sem filtro. */
export async function resolverAlvoDocumento(ctx: CtxGed, f: Pick<FiltrosLogs, "documento">): Promise<AlvoDocumento> {
  if (!f.documento) return null;
  if (documentoEhId(f)) return { ids: [f.documento] };
  const docs = await ctx.db.gedDocumento.findMany({ where: { numero: { contains: f.documento, mode: "insensitive" } }, select: { id: true }, take: 50 });
  return { ids: docs.map((d) => d.id) };
}

async function nomesUsuarios(ctx: CtxGed, ids: (string | null)[]): Promise<Map<string, string>> {
  const lista = [...new Set(ids.filter((x): x is string => !!x))];
  if (!lista.length) return new Map();
  const us = await ctx.db.usuario.findMany({ where: { id: { in: lista }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

async function numerosDocumentos(ctx: CtxGed, ids: (string | null)[]): Promise<Map<string, string>> {
  const lista = [...new Set(ids.filter((x): x is string => !!x))];
  if (!lista.length) return new Map();
  const ds = await ctx.db.gedDocumento.findMany({ where: { id: { in: lista } }, select: { id: true, numero: true } });
  const nums = new Map(ds.map((d) => [d.id, d.numero]));
  // Documento excluído (exclusão controlada): o log de acesso é preservado e o número vem da auditoria imutável.
  const faltam = lista.filter((id) => !nums.has(id));
  if (faltam.length) {
    const aud = await ctx.db.logAuditoria.findMany({ where: { organizacao_id: ctx.organizacao_id, acao: "GED_DOCUMENTO_EXCLUIDO", entidade_id: { in: faltam } }, select: { entidade_id: true, antes: true } });
    for (const a of aud) {
      const numero = (a.antes as { numero?: unknown } | null)?.numero;
      if (a.entidade_id && typeof numero === "string") nums.set(a.entidade_id, `${numero} (excluído)`);
    }
  }
  return nums;
}

// ───────────── Páginas ─────────────

async function acessosDe(ctx: CtxGed, where: ReturnType<typeof whereAcessos>, skip: number, take: number, cursor?: bigint): Promise<LinhaAcesso[]> {
  const rows = await ctx.db.gedAcessoLog.findMany({ where, orderBy: { id: "desc" }, skip: cursor ? 1 : skip, take, ...(cursor ? { cursor: { id: cursor } } : {}) });
  const [nomes, nums] = await Promise.all([nomesUsuarios(ctx, rows.map((r) => r.usuario_id)), numerosDocumentos(ctx, rows.map((r) => r.documento_id))]);
  return rows.map((r) => ({
    id: r.id.toString(), quando: r.created_at, usuario: r.usuario_id ? nomes.get(r.usuario_id) ?? "—" : null, acao: r.acao,
    documento_id: r.documento_id, documento_numero: r.documento_id ? nums.get(r.documento_id) ?? null : null, ip: r.ip,
  }));
}

async function comunicacoesDe(ctx: CtxGed, where: ReturnType<typeof whereComunicacoes>, skip: number, take: number, cursor?: string): Promise<LinhaComunicacao[]> {
  const rows = await ctx.db.gedComunicacao.findMany({ where, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: cursor ? 1 : skip, take, ...(cursor ? { cursor: { id: cursor } } : {}) });
  const [nomes, nums] = await Promise.all([nomesUsuarios(ctx, rows.map((r) => r.usuario_id)), numerosDocumentos(ctx, rows.map((r) => r.documento_id))]);
  return rows.map((r) => ({
    id: r.id, quando: r.created_at, enviado_em: r.enviado_em, canal: r.canal, destinatario_mascarado: r.destinatario_mascarado, evento: r.evento,
    evento_rotulo: ({ ...ROTULO_EVENTO, ...ROTULO_EVENTO_PROTOCOLO } as Record<string, string>)[r.evento] ?? r.evento, status: r.status, erro: r.erro ? r.erro.replace(/^\[t\d+\]\s*/, "") : null,
    usuario: r.usuario_id ? nomes.get(r.usuario_id) ?? "—" : "Interessado (protocolo)", documento_id: r.documento_id, documento_numero: r.documento_id ? nums.get(r.documento_id) ?? null : null,
  }));
}

async function alteracoesDe(ctx: CtxGed, where: ReturnType<typeof whereAlteracoes>, skip: number, take: number, cursor?: string): Promise<LinhaAlteracao[]> {
  const rows = await ctx.db.logAuditoria.findMany({ where, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: cursor ? 1 : skip, take, ...(cursor ? { cursor: { id: cursor } } : {}) });
  const nomes = await nomesUsuarios(ctx, rows.map((r) => r.usuario_id));
  return rows.map((r) => ({
    id: r.id, quando: r.created_at, usuario: r.usuario_id ? nomes.get(r.usuario_id) ?? "—" : null, acao: r.acao, entidade: r.entidade, entidade_id: r.entidade_id,
    antes: resumirJson(r.antes), depois: resumirJson(r.depois),
  }));
}

export async function listarAcessos(ctx: CtxGed, f: FiltrosLogs): Promise<Pagina<LinhaAcesso>> {
  exigirLogs(ctx);
  const where = whereAcessos(f, await resolverAlvoDocumento(ctx, f));
  const [total, itens] = await Promise.all([ctx.db.gedAcessoLog.count({ where }), acessosDe(ctx, where, (f.page - 1) * TAMANHO_PAGINA_LOGS, TAMANHO_PAGINA_LOGS)]);
  return { total, itens, page: f.page, size: TAMANHO_PAGINA_LOGS };
}

export async function listarComunicacoes(ctx: CtxGed, f: FiltrosLogs): Promise<Pagina<LinhaComunicacao>> {
  exigirLogs(ctx);
  const where = whereComunicacoes(f, await resolverAlvoDocumento(ctx, f));
  const [total, itens] = await Promise.all([ctx.db.gedComunicacao.count({ where }), comunicacoesDe(ctx, where, (f.page - 1) * TAMANHO_PAGINA_LOGS, TAMANHO_PAGINA_LOGS)]);
  return { total, itens, page: f.page, size: TAMANHO_PAGINA_LOGS };
}

export async function listarAlteracoes(ctx: CtxGed, f: FiltrosLogs): Promise<Pagina<LinhaAlteracao>> {
  exigirLogs(ctx);
  const where = whereAlteracoes(ctx.organizacao_id, f, await resolverAlvoDocumento(ctx, f));
  const [total, itens] = await Promise.all([ctx.db.logAuditoria.count({ where }), alteracoesDe(ctx, where, (f.page - 1) * TAMANHO_PAGINA_LOGS, TAMANHO_PAGINA_LOGS)]);
  return { total, itens, page: f.page, size: TAMANHO_PAGINA_LOGS };
}

/** Membros do cliente para o filtro "usuário". */
export async function usuariosParaFiltro(ctx: CtxGed): Promise<{ id: string; nome: string }[]> {
  exigirLogs(ctx);
  const ms = await ctx.db.gedMembro.findMany({ select: { usuario: { select: { id: true, nome: true } } } });
  return ms.map((m) => m.usuario).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// ───────────── Logs de um documento ─────────────

export type LogsDoDocumento = { acessos: LinhaAcesso[]; comunicacoes: LinhaComunicacao[]; alteracoes: LinhaAlteracao[] };

/** Auditores/administradores do GED, ou quem tem ADMINISTRAR no documento (`acoes` = ações efetivas já calculadas pela página). */
export function podeVerLogsDoDocumento(ctx: CtxGed, acoes: readonly string[]): boolean {
  return podeVerLogs(ctx) || acoes.includes("ADMINISTRAR");
}

const FILTRO_VAZIO: FiltrosLogs = { aba: "acessos", de: null, ate: null, usuario_id: null, documento: null, acao: null, canal: null, status: null, evento: null, page: 1 };

export async function logsDoDocumento(ctx: CtxGed, documentoId: string, acoes: readonly string[], limite = 50): Promise<LogsDoDocumento> {
  if (!podeVerLogsDoDocumento(ctx, acoes)) throw proibido("Sem permissão para ver os logs deste documento.");
  const alvo: AlvoDocumento = { ids: [documentoId] };
  const [acessos, comunicacoes, alteracoes] = await Promise.all([
    acessosDe(ctx, whereAcessos(FILTRO_VAZIO, alvo), 0, limite),
    comunicacoesDe(ctx, whereComunicacoes(FILTRO_VAZIO, alvo), 0, limite),
    alteracoesDe(ctx, whereAlteracoes(ctx.organizacao_id, FILTRO_VAZIO, alvo), 0, limite),
  ]);
  return { acessos, comunicacoes, alteracoes };
}

// ───────────── Exportação CSV (streaming) ─────────────

const LOTE_CSV = 1000;
/** Teto de linhas por exportação (a retenção/BRIN cuida do volume; períodos menores com os filtros). */
export const MAX_LINHAS_CSV = 200_000;

const juntar = (l: CampoResumo[]) => l.map((c) => `${c.campo}: ${c.valor}`).join("; ");
const fmtBr = (d: Date | null) => (d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(d) : "");

/** Resposta CSV em fluxo da visão filtrada (mesmos filtros da tela), escopada ao cliente e auditada. */
export async function csvDosLogs(ctx: CtxGed, f: FiltrosLogs): Promise<{ nome: string; corpo: ReadableStream<Uint8Array> }> {
  exigirLogs(ctx);
  const alvo = await resolverAlvoDocumento(ctx, f);
  await auditarGed(ctx, { acao: "GED_LOGS_EXPORTADOS", entidade: "ged_logs", depois: { aba: f.aba, filtros: paramsDosFiltros(f) } });
  const enc = new TextEncoder();
  const cabecalhos: Record<FiltrosLogs["aba"], string[]> = {
    acessos: ["Data/hora (Brasília)", "Usuário", "Ação", "Documento", "IP"],
    alteracoes: ["Data/hora (Brasília)", "Usuário", "Ação", "Entidade", "Antes", "Depois"],
    comunicacoes: ["Criada em (Brasília)", "Enviada em (Brasília)", "Canal", "Destinatário", "Evento", "Status", "Erro", "Documento"],
  };
  let enviadas = 0;
  let cursor: string | undefined;
  let primeiro = true;
  const corpo = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (primeiro) {
        primeiro = false;
        ctrl.enqueue(enc.encode(BOM_UTF8 + linhaCsv(cabecalhos[f.aba])));
      }
      if (enviadas >= MAX_LINHAS_CSV) return ctrl.close();
      const take = Math.min(LOTE_CSV, MAX_LINHAS_CSV - enviadas);
      let texto = "";
      let n = 0;
      if (f.aba === "acessos") {
        const l = await acessosDe(ctx, whereAcessos(f, alvo), 0, take, cursor ? BigInt(cursor) : undefined);
        n = l.length;
        cursor = l.at(-1)?.id;
        for (const r of l) texto += linhaCsv([fmtBr(r.quando), r.usuario ?? "", r.acao, r.documento_numero ?? "", r.ip ?? ""]);
      } else if (f.aba === "comunicacoes") {
        const l = await comunicacoesDe(ctx, whereComunicacoes(f, alvo), 0, take, cursor);
        n = l.length;
        cursor = l.at(-1)?.id;
        for (const r of l) texto += linhaCsv([fmtBr(r.quando), fmtBr(r.enviado_em), r.canal, r.destinatario_mascarado, r.evento_rotulo, r.status, r.erro ?? "", r.documento_numero ?? ""]);
      } else {
        const l = await alteracoesDe(ctx, whereAlteracoes(ctx.organizacao_id, f, alvo), 0, take, cursor);
        n = l.length;
        cursor = l.at(-1)?.id;
        for (const r of l) texto += linhaCsv([fmtBr(r.quando), r.usuario ?? "", r.acao, r.entidade, juntar(r.antes), juntar(r.depois)]);
      }
      if (texto) ctrl.enqueue(enc.encode(texto));
      enviadas += n;
      if (n < take) ctrl.close();
    },
  });
  return { nome: `ged-logs-${f.aba}-${new Date().toISOString().slice(0, 10)}.csv`, corpo };
}
