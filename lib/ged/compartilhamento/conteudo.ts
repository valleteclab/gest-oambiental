// O QUE o destinatário pode ver, decidido a CADA requisição (nada vem do cliente): o conjunto permitido é recalculado como o criador do
// link no momento do acesso (docs/ged.md §18):
//
//   conjunto = documentos que o CRIADOR pode VER agora (whereGedVisivel, ACL/pasta/setor)  ∩  compartilháveis (whereCompartilhavel:
//              nunca SIGILOSO, nem dados pessoais/anonimização pendente, excluído ou arquivado)  ∩  dentro do recurso do link
//              (o documento, ou a subárvore da pasta com pastas que o criador vê)  ∩  (se congelado) a lista guardada na criação.
//
// Decisão (dinâmico por padrão): documento novo na pasta ENTRA no link; documento que o criador deixou de ver, tornou sigiloso,
// arquivou ou excluiu SAI. "Congelar" guarda a lista de ids na criação: só entram os que estavam nela (e ainda são permitidos).
// Se o criador perde o acesso ao GED, o papel de compartilhar ou é desativado, o link deixa de funcionar (404).
import type { GedCompartilhamento, Prisma } from "@prisma/client";
import { ctxGedPorUsuarioId, type CtxGed } from "../escopo";
import { ErroApi } from "@/lib/http";
import { podeGed } from "../papeis";
import { acoesDaPasta, whereGedPastasVisiveis, whereGedVisivel } from "../permissoes";
import { lerArquivoGed } from "../storage";
import { MENSAGEM_LINK_INVALIDO, whereCompartilhavel } from "./regras";

/** 404 único do fluxo público: pasta/documento fora do conjunto permitido é indistinguível de inexistente. */
const naoEncontrado = () => new ErroApi(404, "NAO_ENCONTRADO", MENSAGEM_LINK_INVALIDO);

export type LinkEscopo = Pick<GedCompartilhamento, "id" | "organizacao_id" | "criado_por_id" | "recurso_tipo" | "documento_id" | "pasta_id" | "congelado" | "itens_congelados">;

export type EscopoLink = {
  ctx: CtxGed;
  tipo: "DOCUMENTO" | "PASTA";
  /** Conjunto de documentos permitido AGORA (já combina visibilidade do criador, elegibilidade, recurso e congelamento). */
  docWhere: Prisma.GedDocumentoWhereInput;
  raiz: { id: string; nome: string } | null;
  /** Pastas da subárvore que o criador vê (inclui a raiz). Vazio para documento. */
  pastas: { id: string; parent_id: string | null; nome: string; caminho_ids: string[] }[];
};

/** Monta o escopo como o criador. null = link inoperante (criador sem acesso, recurso inexistente/invisível). */
export async function carregarEscopoLink(l: LinkEscopo): Promise<EscopoLink | null> {
  const ctx = await ctxGedPorUsuarioId(l.criado_por_id);
  if (!ctx || ctx.organizacao_id !== l.organizacao_id || !podeGed(ctx, "compartilhar")) return null;
  const base: Prisma.GedDocumentoWhereInput[] = [await whereGedVisivel(ctx, "VER"), whereCompartilhavel()];
  if (l.congelado) base.push({ id: { in: l.itens_congelados } });

  if (l.recurso_tipo === "DOCUMENTO") {
    if (!l.documento_id) return null;
    return { ctx, tipo: "DOCUMENTO", docWhere: { AND: [...base, { id: l.documento_id }] }, raiz: null, pastas: [] };
  }
  if (!l.pasta_id) return null;
  const raiz = await ctx.db.gedPasta.findFirst({ where: { id: l.pasta_id, excluido_em: null }, select: { id: true, nome: true, organizacao_id: true, caminho_heranca: true } });
  if (!raiz) return null;
  if (!(await acoesDaPasta(ctx, raiz)).includes("VER")) return null;
  const pastas = await ctx.db.gedPasta.findMany({
    where: { AND: [{ caminho_ids: { has: raiz.id }, excluido_em: null }, await whereGedPastasVisiveis(ctx)] },
    select: { id: true, parent_id: true, nome: true, caminho_ids: true },
    take: 20_000,
  });
  return { ctx, tipo: "PASTA", docWhere: { AND: [...base, { pasta_id: { in: pastas.map((p) => p.id) } }] }, raiz: { id: raiz.id, nome: raiz.nome }, pastas };
}

/** PURA: pastas da subárvore que têm documentos permitidos (elas ou descendentes) e o total acumulado por pasta. */
export function calcularConteudoPastas(pastas: { id: string; caminho_ids: string[] }[], contagem: ReadonlyMap<string, number>): { comConteudo: Set<string>; total: Map<string, number> } {
  const porId = new Set(pastas.map((p) => p.id));
  const comConteudo = new Set<string>();
  const total = new Map<string, number>();
  for (const p of pastas) {
    const n = contagem.get(p.id) ?? 0;
    if (n <= 0) continue;
    for (const anc of p.caminho_ids) {
      if (!porId.has(anc)) continue;
      comConteudo.add(anc);
      total.set(anc, (total.get(anc) ?? 0) + n);
    }
  }
  return { comConteudo, total };
}

export type ItemDocumento = { id: string; numero: string; titulo: string; data_documento: Date | null; status: string; mime: string; tamanho: number; paginas: number | null; nome_arquivo: string };
export type ItemPasta = { id: string; nome: string; documentos: number };
export type ListaItens = {
  tipo: "DOCUMENTO" | "PASTA";
  pasta_atual: { id: string; nome: string; caminho: { id: string; nome: string }[] } | null;
  subpastas: ItemPasta[];
  documentos: ItemDocumento[];
  total_documentos: number;
  truncado: boolean;
};
const MAX_DOCS_LISTA = 300;

/** Lista o que está no conjunto permitido (pasta atual ou o documento). `pastaId` fora da subárvore/sem conteúdo permitido → 404. */
export async function listarItensPermitidos(e: EscopoLink, pastaId?: string | null): Promise<ListaItens> {
  const { ctx } = e;
  let where: Prisma.GedDocumentoWhereInput = e.docWhere;
  let pasta_atual: ListaItens["pasta_atual"] = null;
  let subpastas: ItemPasta[] = [];

  if (e.tipo === "PASTA" && e.raiz) {
    const porId = new Map(e.pastas.map((p) => [p.id, p]));
    // contagem de documentos permitidos por pasta → quais pastas têm conteúdo (elas e suas ancestrais)
    const grupos = await ctx.db.gedDocumento.groupBy({ by: ["pasta_id"], where: e.docWhere, _count: { _all: true } });
    const { comConteudo, total } = calcularConteudoPastas(e.pastas, new Map(grupos.flatMap((g) => (g.pasta_id ? [[g.pasta_id, g._count._all] as const] : []))));
    const atualId = pastaId ?? e.raiz.id;
    const atual = porId.get(atualId);
    if (!atual || (atualId !== e.raiz.id && !comConteudo.has(atualId))) throw naoEncontrado();
    const caminho = atual.caminho_ids.slice(atual.caminho_ids.indexOf(e.raiz.id)).flatMap((id) => (porId.get(id) ? [{ id, nome: porId.get(id)!.nome }] : []));
    pasta_atual = { id: atual.id, nome: atual.nome, caminho };
    subpastas = e.pastas
      .filter((p) => p.parent_id === atual.id && comConteudo.has(p.id))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
      .map((p) => ({ id: p.id, nome: p.nome, documentos: total.get(p.id) ?? 0 }));
    where = { AND: [e.docWhere, { pasta_id: atual.id }] };
  }

  const [docs, totalDocs] = await Promise.all([
    ctx.db.gedDocumento.findMany({
      where,
      orderBy: [{ numero: "asc" }],
      take: MAX_DOCS_LISTA,
      select: { id: true, numero: true, titulo: true, data_documento: true, status: true, versao_atual_id: true },
    }),
    ctx.db.gedDocumento.count({ where }),
  ]);
  const versoes = docs.length
    ? await ctx.db.gedVersaoDocumento.findMany({ where: { id: { in: docs.flatMap((d) => (d.versao_atual_id ? [d.versao_atual_id] : [])) } }, select: { id: true, mime: true, tamanho: true, paginas: true, nome_arquivo: true } })
    : [];
  const vp = new Map(versoes.map((v) => [v.id, v]));
  const documentos: ItemDocumento[] = docs.flatMap((d) => {
    const v = d.versao_atual_id ? vp.get(d.versao_atual_id) : undefined;
    return v ? [{ id: d.id, numero: d.numero, titulo: d.titulo, data_documento: d.data_documento, status: d.status, mime: v.mime, tamanho: v.tamanho, paginas: v.paginas, nome_arquivo: v.nome_arquivo }] : [];
  });
  return { tipo: e.tipo, pasta_atual, subpastas, documentos, total_documentos: totalDocs, truncado: totalDocs > docs.length };
}

export type ArquivoPermitido = { dados: Buffer; mime: string; nome: string; sha256: string; documento_id: string; versao_id: string };

/** Arquivo da versão atual de UM documento do conjunto permitido (senão 404). A chave de storage nunca sai do servidor. */
export async function lerArquivoPermitido(e: EscopoLink, documentoId: string): Promise<ArquivoPermitido> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentoId)) throw naoEncontrado();
  const doc = await e.ctx.db.gedDocumento.findFirst({ where: { AND: [e.docWhere, { id: documentoId }] }, select: { id: true, versao_atual_id: true } });
  if (!doc?.versao_atual_id) throw naoEncontrado();
  const v = await e.ctx.db.gedVersaoDocumento.findFirst({ where: { id: doc.versao_atual_id, documento_id: doc.id }, select: { id: true, storage_key: true, mime: true, nome_arquivo: true, sha256: true } });
  if (!v) throw naoEncontrado();
  let dados: Buffer;
  try {
    dados = await lerArquivoGed(e.ctx.organizacao_id, v.storage_key);
  } catch {
    throw naoEncontrado();
  }
  return { dados, mime: v.mime, nome: v.nome_arquivo, sha256: v.sha256, documento_id: doc.id, versao_id: v.id };
}

/** O id de pasta pedido para o ZIP pertence à subárvore permitida (e tem conteúdo)? Devolve o id a exportar ou lança 404. */
export function pastaDoZip(e: EscopoLink, pastaId?: string | null): string {
  if (e.tipo !== "PASTA" || !e.raiz) throw naoEncontrado();
  const id = pastaId ?? e.raiz.id;
  if (!e.pastas.some((p) => p.id === id)) throw naoEncontrado();
  return id;
}
