// Filtros da lista de documentos (URL → filtros → where do Prisma). PURO: sem banco, testado em tests/unit/ged-documentos-filtros.test.ts.
// A visibilidade (whereGedVisivel) NUNCA é montada aqui: quem lista combina `montarWhereFiltros()` com ela via AND.
import type { GedSensibilidade, GedStatusDocumento, Prisma } from "@prisma/client";

export const TAMANHOS_PAGINA = [10, 20, 50, 100] as const;
export const TAMANHO_PADRAO = 20;
export const MAX_PAGINA = 100_000;

export const CAMPOS_ORDEM = ["relevancia", "atualizado", "criado", "data", "titulo", "numero"] as const;
export type CampoOrdem = (typeof CAMPOS_ORDEM)[number];
export const ROTULO_ORDEM: Record<CampoOrdem, string> = {
  relevancia: "Relevância (busca no conteúdo)",
  atualizado: "Última atualização",
  criado: "Data de criação",
  data: "Data do documento",
  titulo: "Título",
  numero: "Número",
};

const STATUS: readonly GedStatusDocumento[] = ["RASCUNHO", "PUBLICADO", "EM_ASSINATURA", "ASSINADO", "RECUSADO", "ARQUIVADO"];
const SENS: readonly GedSensibilidade[] = ["PUBLICO", "RESTRITO", "SIGILOSO"];
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export type FiltrosDocumentos = {
  /** Busca no CONTEÚDO do arquivo (texto completo). */
  q: string;
  titulo: string;
  remetente: string;
  /** yyyy-mm-dd (data do documento) */
  de: string | null;
  ate: string | null;
  tipo: string | null;
  status: GedStatusDocumento | null;
  /** id da pasta (inclui subpastas) ou "sem" (documentos sem pasta). */
  pasta: string | null;
  /** O documento precisa ter TODOS os marcadores. */
  marcadores: string[];
  sens: GedSensibilidade | null;
  pessoais: boolean;
  arquivados: boolean;
  ordem: CampoOrdem;
  dir: "asc" | "desc";
  page: number;
  size: number;
};

type Entrada = Record<string, string | string[] | undefined> | URLSearchParams;

function pegar(e: Entrada, k: string): string[] {
  if (e instanceof URLSearchParams) return e.getAll(k);
  const v = e[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
const um = (e: Entrada, k: string) => (pegar(e, k)[0] ?? "").trim();
const texto = (e: Entrada, k: string, max = 200) => um(e, k).replace(/\s+/g, " ").slice(0, max);

export function dataValida(s: string | null | undefined): s is string {
  if (!s || !RE_DATA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Lê e SANEIA os parâmetros da URL (valores inválidos viram o padrão; nunca lança). */
export function lerFiltros(e: Entrada): FiltrosDocumentos {
  const q = texto(e, "q");
  const de = um(e, "de");
  const ate = um(e, "ate");
  const status = um(e, "status") as GedStatusDocumento;
  const sens = um(e, "sens") as GedSensibilidade;
  const pasta = um(e, "pasta");
  const tipo = um(e, "tipo");
  const marcadores = [...new Set(pegar(e, "marcador").map((m) => m.trim()).filter((m) => RE_UUID.test(m)))].slice(0, 10);
  const [campoBruto, dirBruto] = um(e, "ordem").split(":");
  const padrao: CampoOrdem = q ? "relevancia" : "atualizado";
  let ordem: CampoOrdem = (CAMPOS_ORDEM as readonly string[]).includes(campoBruto) ? (campoBruto as CampoOrdem) : padrao;
  if (ordem === "relevancia" && !q) ordem = "atualizado";
  const dir: "asc" | "desc" = dirBruto === "asc" || dirBruto === "desc" ? dirBruto : ordem === "titulo" || ordem === "numero" ? "asc" : "desc";
  const sizeN = Number(um(e, "size"));
  const pageN = Math.floor(Number(um(e, "page")));
  return {
    q,
    titulo: texto(e, "titulo"),
    remetente: texto(e, "remetente"),
    de: dataValida(de) ? de : null,
    ate: dataValida(ate) ? ate : null,
    tipo: RE_UUID.test(tipo) ? tipo : null,
    status: STATUS.includes(status) ? status : null,
    pasta: pasta === "sem" ? "sem" : RE_UUID.test(pasta) ? pasta : null,
    marcadores,
    sens: SENS.includes(sens) ? sens : null,
    pessoais: um(e, "pessoais") === "1",
    arquivados: um(e, "arquivados") === "1",
    ordem,
    dir,
    page: Number.isFinite(pageN) ? Math.min(MAX_PAGINA, Math.max(1, pageN)) : 1,
    size: (TAMANHOS_PAGINA as readonly number[]).includes(sizeN) ? sizeN : TAMANHO_PADRAO,
  };
}

/** Querystring canônica (omite padrões) – a URL é compartilhável. `mudar` sobrepõe campos (ex.: { page: 2 }). */
export function filtrosParaQuery(f: FiltrosDocumentos, mudar: Partial<FiltrosDocumentos> = {}): string {
  const g = { ...f, ...mudar };
  const p = new URLSearchParams();
  if (g.q) p.set("q", g.q);
  if (g.titulo) p.set("titulo", g.titulo);
  if (g.remetente) p.set("remetente", g.remetente);
  if (g.de) p.set("de", g.de);
  if (g.ate) p.set("ate", g.ate);
  if (g.tipo) p.set("tipo", g.tipo);
  if (g.status) p.set("status", g.status);
  if (g.pasta) p.set("pasta", g.pasta);
  for (const m of g.marcadores) p.append("marcador", m);
  if (g.sens) p.set("sens", g.sens);
  if (g.pessoais) p.set("pessoais", "1");
  if (g.arquivados) p.set("arquivados", "1");
  const ordemPadrao = (g.q ? "relevancia" : "atualizado") as CampoOrdem;
  if (g.ordem !== ordemPadrao || (g.dir !== (g.ordem === "titulo" || g.ordem === "numero" ? "asc" : "desc"))) p.set("ordem", `${g.ordem}:${g.dir}`);
  if (g.size !== TAMANHO_PADRAO) p.set("size", String(g.size));
  if (g.page > 1) p.set("page", String(g.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Há algum filtro ativo além de ordenação/paginação? */
export const temFiltro = (f: FiltrosDocumentos) =>
  !!(f.q || f.titulo || f.remetente || f.de || f.ate || f.tipo || f.status || f.pasta || f.marcadores.length || f.sens || f.pessoais || f.arquivados);

/**
 * Where dos filtros (sem a visibilidade). `ids` = interseção já calculada das buscas por texto (conteúdo/título/remetente);
 * `null` = sem restrição por id; lista vazia = nada casa.
 */
export function montarWhereFiltros(f: FiltrosDocumentos, ids: string[] | null = null): Prisma.GedDocumentoWhereInput {
  const and: Prisma.GedDocumentoWhereInput[] = [{ excluido_em: null }];
  if (f.status) and.push({ status: f.status });
  else if (!f.arquivados) and.push({ status: { not: "ARQUIVADO" } });
  if (f.de || f.ate) {
    and.push({
      data_documento: {
        ...(f.de ? { gte: new Date(`${f.de}T00:00:00Z`) } : {}),
        ...(f.ate ? { lte: new Date(`${f.ate}T00:00:00Z`) } : {}),
      },
    });
  }
  if (f.tipo) and.push({ tipo_id: f.tipo });
  if (f.pasta === "sem") and.push({ pasta_id: null });
  else if (f.pasta) and.push({ pasta: { is: { caminho_ids: { has: f.pasta } } } });
  for (const m of f.marcadores) and.push({ marcadores: { some: { marcador_id: m } } });
  if (f.sens) and.push({ sensibilidade: f.sens });
  if (f.pessoais) and.push({ contem_dados_pessoais: true });
  if (ids) and.push({ id: { in: ids } });
  return { AND: and };
}

/** orderBy do Prisma (relevância é tratada à parte, pelo rank da busca). Sempre com desempate estável por id. */
export function orderByDe(f: Pick<FiltrosDocumentos, "ordem" | "dir">): Prisma.GedDocumentoOrderByWithRelationInput[] {
  const d = f.dir;
  switch (f.ordem) {
    case "titulo": return [{ titulo: d }, { id: "asc" }];
    case "numero": return [{ numero: d }, { id: "asc" }];
    case "criado": return [{ created_at: d }, { id: "asc" }];
    case "data": return [{ data_documento: { sort: d, nulls: "last" } }, { id: "asc" }];
    default: return [{ updated_at: d }, { id: "asc" }];
  }
}

/** Interseção de listas de ids (null = "sem restrição"). */
export function intersectar(listas: (string[] | null)[]): string[] | null {
  let atual: string[] | null = null;
  for (const l of listas) {
    if (l === null) continue;
    if (atual === null) atual = [...l];
    else {
      const s = new Set(l);
      atual = atual.filter((x) => s.has(x));
    }
  }
  return atual;
}

/** Ordena ids pelo rank da busca (maior primeiro); empate mantém a ordem de entrada (estável). */
export function ordenarPorRank(ids: string[], rank: Map<string, number>, dir: "asc" | "desc" = "desc"): string[] {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const sinal = dir === "desc" ? -1 : 1;
  return [...ids].sort((a, b) => sinal * ((rank.get(a) ?? 0) - (rank.get(b) ?? 0)) || (idx.get(a)! - idx.get(b)!));
}

export const paginar = <T,>(l: T[], page: number, size: number): T[] => l.slice((page - 1) * size, page * size);
