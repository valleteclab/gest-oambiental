// BUSCA DO GED – único arquivo (com db.ts) autorizado a usar SQL cru (tests/unit/ged-fontes.test.ts).
//
// Arquitetura de segurança (docs/ged-design.md §6/§7):
//   1. Consultas CRUAS só devolvem IDs (+ rank) e SEMPRE com `organizacao_id = $1` (o contexto, nunca a entrada do usuário).
//      Elas NÃO decidem visibilidade.
//   2. Quem lista (documentos/listar.ts) combina esses ids com `whereGedVisivel(ctx,"VER")` no Prisma (SQL, nunca pós-filtro).
//   3. Trechos (ts_headline) são gerados só para ids já autorizados – e `snippetsDeConteudo` reautoriza por conta própria.
// O cliente usado é `ctx.db` (extensão de escopo); `$queryRawUnsafe` não é interceptado pela extensão, por isso `consultar`
// exige o literal `organizacao_id = $1::uuid` no SQL e passa sempre `ctx.organizacao_id` como $1.
import { whereGedVisivel } from "./permissoes";
import type { CtxGed } from "./escopo";
import { MARCA_FIM, MARCA_INI, montarTrechos, type TrechoSnippet } from "./documentos/snippet";

export const LIMITE_BUSCA_CONTEUDO = 500;
export const LIMITE_BUSCA_TEXTO = 5000;
const MAX_PALAVRAS_TITULO = 6;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Executa SQL cru ancorado no tenant: $1 = organização do contexto; o SQL precisa conter `organizacao_id = $1::uuid`. */
export async function consultar<T>(ctx: Pick<CtxGed, "db" | "organizacao_id">, sql: string, params: unknown[] = []): Promise<T[]> {
  if (!/organizacao_id\s*=\s*\$1::uuid/.test(sql)) throw new Error("GED busca: SQL sem âncora de organização.");
  if (/;\s*\S/.test(sql)) throw new Error("GED busca: SQL com múltiplas instruções.");
  if (!RE_UUID.test(ctx.organizacao_id)) throw new Error("GED busca: organização inválida.");
  return (await ctx.db.$queryRawUnsafe(sql, ctx.organizacao_id, ...params)) as T[];
}

/** Normaliza a consulta do usuário (websearch_to_tsquery interpreta aspas, "or" e "-"). */
export const normalizarConsulta = (q: string) => q.replace(/\s+/g, " ").trim().slice(0, 200);

export type AcertoConteudo = { id: string; rank: number };

/** Passo 1: documentos (ids + rank) cujo conteúdo casa com a consulta. Sem visibilidade! (ver cabeçalho) */
export async function idsPorConteudo(ctx: CtxGed, consulta: string, limite = LIMITE_BUSCA_CONTEUDO): Promise<AcertoConteudo[]> {
  const q = normalizarConsulta(consulta);
  if (!q) return [];
  const linhas = await consultar<{ documento_id: string; rank: number }>(
    ctx,
    `SELECT c.documento_id::text AS documento_id, max(ts_rank(c.tsv, k.t))::float8 AS rank
       FROM ged_conteudo_texto c, (SELECT websearch_to_tsquery('portuguese', ged_unaccent($2)) AS t) k
      WHERE c.organizacao_id = $1::uuid AND c.tsv @@ k.t
      GROUP BY c.documento_id
      ORDER BY rank DESC, c.documento_id
      LIMIT ${Math.min(limite, LIMITE_BUSCA_CONTEUDO)}`,
    [q],
  );
  return linhas.map((l) => ({ id: l.documento_id, rank: Number(l.rank) }));
}

/**
 * Passo 1 (título/remetente): ids de documentos cujo título/remetente contém TODAS as palavras, sem acento e sem
 * diferenciar maiúsculas (usa o índice trigram de ged_unaccent(lower(...))). null = filtro não informado.
 */
export async function idsPorTexto(ctx: CtxGed, f: { titulo?: string; remetente?: string }, limite = LIMITE_BUSCA_TEXTO): Promise<string[] | null> {
  const params: unknown[] = [];
  const conds: string[] = [];
  const acrescentar = (coluna: "titulo" | "remetente", valor?: string) => {
    const palavras = (valor ?? "").split(/\s+/).filter(Boolean).slice(0, MAX_PALAVRAS_TITULO);
    for (const p of palavras) {
      params.push(p.slice(0, 80));
      const i = params.length + 1; // $1 = organização
      conds.push(`ged_unaccent(lower(${coluna})) LIKE '%' || replace(replace(replace(ged_unaccent(lower($${i})), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'`);
    }
  };
  acrescentar("titulo", f.titulo);
  acrescentar("remetente", f.remetente);
  if (!conds.length) return null;
  const linhas = await consultar<{ id: string }>(
    ctx,
    `SELECT id::text AS id FROM ged_documento WHERE organizacao_id = $1::uuid AND excluido_em IS NULL AND ${conds.join(" AND ")} LIMIT ${Math.min(limite, LIMITE_BUSCA_TEXTO)}`,
    params,
  );
  return linhas.map((l) => l.id);
}

export type SnippetDocumento = { documento_id: string; trechos: TrechoSnippet[] };

/**
 * Passo 3: trechos com destaque para os documentos da PÁGINA ATUAL. Reautoriza (VER) os ids antes de tocar no texto:
 * mesmo que o chamador erre, nunca sai trecho de documento que o usuário não pode ver.
 */
export async function snippetsDeConteudo(ctx: CtxGed, consulta: string, ids: string[]): Promise<Map<string, TrechoSnippet[]>> {
  const q = normalizarConsulta(consulta);
  const res = new Map<string, TrechoSnippet[]>();
  const candidatos = ids.filter((i) => RE_UUID.test(i)).slice(0, 200);
  if (!q || !candidatos.length) return res;
  const autorizados = await ctx.db.gedDocumento.findMany({
    where: { AND: [await whereGedVisivel(ctx, "VER"), { id: { in: candidatos } }] },
    select: { id: true },
  });
  const ok = autorizados.map((d) => d.id);
  if (!ok.length) return res;
  const linhas = await consultar<{ documento_id: string; marcado: string; original: string | null }>(
    ctx,
    `WITH k AS (SELECT websearch_to_tsquery('portuguese', ged_unaccent($2)) AS t),
          h AS (
            SELECT DISTINCT ON (c.documento_id) c.documento_id, c.texto, ged_unaccent(c.texto) AS plano,
                   ts_headline('portuguese', ged_unaccent(c.texto), k.t,
                     'StartSel=${MARCA_INI}, StopSel=${MARCA_FIM}, MaxWords=32, MinWords=14, ShortWord=2, MaxFragments=0, HighlightAll=false') AS marcado
              FROM ged_conteudo_texto c, k
             WHERE c.organizacao_id = $1::uuid AND c.documento_id = ANY($3::uuid[]) AND c.tsv @@ k.t
             ORDER BY c.documento_id, ts_rank(c.tsv, k.t) DESC)
     SELECT h.documento_id::text AS documento_id, h.marcado,
            CASE WHEN p.pos > 0 THEN substr(h.texto, p.pos, length(p.limpo)) END AS original
       FROM h
       CROSS JOIN LATERAL (SELECT replace(replace(h.marcado, '${MARCA_INI}', ''), '${MARCA_FIM}', '') AS limpo) l
       CROSS JOIN LATERAL (SELECT l.limpo, strpos(h.plano, l.limpo) AS pos) p`,
    [q, ok],
  );
  for (const l of linhas) res.set(l.documento_id, montarTrechos(l.marcado, l.original));
  return res;
}
