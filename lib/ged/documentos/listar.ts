// Listagem/busca de documentos (item 1 do edital) – orquestra a arquitetura de segurança de lib/ged/busca.ts:
//   1. ids por conteúdo/título/remetente (SQL cru, tenant-bound, SEM visibilidade);
//   2. Prisma via ctx.db: AND[ whereGedVisivel(VER), filtros, id IN ids ] – a visibilidade é decidida no SQL, nunca depois;
//   3. trechos (ts_headline) só para os ids da página já autorizada.
import type { GedAnonimizacao, GedSensibilidade, GedStatusDocumento, GedStatusTexto } from "@prisma/client";
import { idsPorConteudo, idsPorTexto, snippetsDeConteudo } from "../busca";
import type { CtxGed } from "../escopo";
import { whereGedVisivel } from "../permissoes";
import { registrarAcessoSeguro } from "./acesso";
import { intersectar, montarWhereFiltros, ordenarPorRank, orderByDe, paginar, type FiltrosDocumentos } from "./filtros";
import type { TrechoSnippet } from "./snippet";

export type LinhaDocumento = {
  id: string;
  numero: string;
  titulo: string;
  status: GedStatusDocumento;
  sensibilidade: GedSensibilidade;
  remetente: string | null;
  data_documento: Date | null;
  created_at: Date;
  updated_at: Date;
  contem_dados_pessoais: boolean;
  anonimizacao_status: GedAnonimizacao;
  tipo: { id: string; nome: string } | null;
  pasta: { id: string; caminho_nome: string } | null;
  marcadores: { id: string; nome: string; cor: string }[];
  texto_status: GedStatusTexto | null;
  paginas: number | null;
  trechos: TrechoSnippet[] | null;
};

export type ResultadoLista = {
  linhas: LinhaDocumento[];
  total: number;
  page: number;
  size: number;
  /** A busca no conteúdo atingiu o limite de resultados considerados (refine a consulta). */
  truncado: boolean;
};

const SELECT_LINHA = {
  id: true, numero: true, titulo: true, status: true, sensibilidade: true, remetente: true, data_documento: true, created_at: true, updated_at: true,
  contem_dados_pessoais: true, anonimizacao_status: true, versao_atual_id: true,
  tipo: { select: { id: true, nome: true } },
  pasta: { select: { id: true, caminho_nome: true } },
  marcadores: { select: { marcador: { select: { id: true, nome: true, cor: true } } } },
} as const;

const VAZIO = (f: FiltrosDocumentos, truncado = false): ResultadoLista => ({ linhas: [], total: 0, page: f.page, size: f.size, truncado });

export async function listarDocumentos(ctx: CtxGed, f: FiltrosDocumentos, opc: { snippets?: boolean; registrar?: boolean } = {}): Promise<ResultadoLista> {
  const comSnippets = opc.snippets ?? true;
  const conteudo = f.q ? await idsPorConteudo(ctx, f.q) : null;
  const porTexto = await idsPorTexto(ctx, { titulo: f.titulo, remetente: f.remetente });
  const ids = intersectar([conteudo ? conteudo.map((c) => c.id) : null, porTexto]);
  if (ids !== null && ids.length === 0) return VAZIO(f);
  const truncado = !!conteudo && conteudo.length >= 500;

  const where = { AND: [await whereGedVisivel(ctx, "VER"), montarWhereFiltros(f, ids)] };
  let total: number;
  let linhas: Awaited<ReturnType<typeof carregarLinhas>>;

  if (conteudo && f.ordem === "relevancia") {
    const rank = new Map(conteudo.map((c) => [c.id, c.rank]));
    const visiveis = (await ctx.db.gedDocumento.findMany({ where, select: { id: true } })).map((d) => d.id);
    total = visiveis.length;
    const pagina = paginar(ordenarPorRank(visiveis, rank, f.dir), f.page, f.size);
    linhas = await carregarLinhas(ctx, { AND: [await whereGedVisivel(ctx, "VER"), { id: { in: pagina } }] }, undefined, pagina);
  } else {
    total = await ctx.db.gedDocumento.count({ where });
    linhas = await carregarLinhas(ctx, where, { orderBy: orderByDe(f), skip: (f.page - 1) * f.size, take: f.size });
  }

  const trechos = comSnippets && f.q && linhas.length ? await snippetsDeConteudo(ctx, f.q, linhas.map((l) => l.id)) : new Map<string, TrechoSnippet[]>();
  if (f.q && (opc.registrar ?? true)) await registrarAcessoSeguro(ctx, "BUSCAR");
  return {
    linhas: linhas.map((l) => ({ ...l, trechos: f.q ? (trechos.get(l.id) ?? null) : null })),
    total,
    page: f.page,
    size: f.size,
    truncado,
  };
}

async function carregarLinhas(
  ctx: CtxGed,
  where: object,
  pag?: { orderBy: ReturnType<typeof orderByDe>; skip: number; take: number },
  ordemIds?: string[],
): Promise<Omit<LinhaDocumento, "trechos">[]> {
  const docs = await ctx.db.gedDocumento.findMany({ where, select: SELECT_LINHA, ...(pag ?? {}) });
  const versaoIds = docs.flatMap((d) => (d.versao_atual_id ? [d.versao_atual_id] : []));
  const versoes = versaoIds.length ? await ctx.db.gedVersaoDocumento.findMany({ where: { id: { in: versaoIds } }, select: { id: true, texto_status: true, paginas: true } }) : [];
  const vm = new Map(versoes.map((v) => [v.id, v]));
  const linhas = docs.map((d) => ({
    id: d.id, numero: d.numero, titulo: d.titulo, status: d.status, sensibilidade: d.sensibilidade, remetente: d.remetente, data_documento: d.data_documento,
    created_at: d.created_at, updated_at: d.updated_at, contem_dados_pessoais: d.contem_dados_pessoais, anonimizacao_status: d.anonimizacao_status,
    tipo: d.tipo, pasta: d.pasta,
    marcadores: d.marcadores.map((m) => m.marcador).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    texto_status: d.versao_atual_id ? (vm.get(d.versao_atual_id)?.texto_status ?? null) : null,
    paginas: d.versao_atual_id ? (vm.get(d.versao_atual_id)?.paginas ?? null) : null,
  }));
  if (!ordemIds) return linhas;
  const por = new Map(linhas.map((l) => [l.id, l]));
  return ordemIds.flatMap((id) => (por.has(id) ? [por.get(id)!] : []));
}
