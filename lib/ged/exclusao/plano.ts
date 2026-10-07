// Plano da exclusão controlada (docs/ged.md §17): o que seria apagado, o que impede e o que sobra. SÓ LEITURA (nenhuma escrita),
// sempre via ctx.db (gedDb) – outro cliente = 404. Usado pela pré-visualização (GET …/excluir), pela confirmação (POST) e,
// de novo, pelo job a cada (re)início, para que a retomada reavalie o que ainda existe.
import type { GedTipoExclusao } from "@prisma/client";
import { proibido } from "@/lib/http";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { podeImportarGed } from "../papeis";
import { acoesDosDocumentos, exigirDocumento, exigirPasta, whereGedPastas, type GedDocumentoMin } from "../permissoes";
import { whereVisiveis } from "../importacao/servico";
import {
  ancestraisOuProprias, confirmacaoEsperada, contarMotivos, emBlocos, mensagemBloqueio, modoSincrono, MAX_BLOQUEADOS_LISTADOS, motivosDeBloqueio, ordenarParaExclusao, pastasCriadasPeloLote,
  pastasRemoviveis, propagarDerivados, type DocumentoBloqueado, type MotivoBloqueio, type PastaCandidata, type PlanoExclusaoPublico,
} from "./regras";

export type AlvoExclusao = { tipo: GedTipoExclusao; id: string };

export type PlanoInterno = {
  publico: PlanoExclusaoPublico;
  /** Documentos que serão excluídos, na ordem (derivados antes dos originais). */
  excluiveis: string[];
  /** Pastas que serão removidas (filhas antes das mães), já considerando o que sobra. */
  pastas_removiveis: string[];
  /** Todas as pastas candidatas (subárvore da pasta / pastas criadas pelo lote). */
  pastas_candidatas: PastaCandidata[];
  nome_pasta: string | null;
  /** Lote de importação ainda recebendo/processando: a exclusão do conteúdo só vale depois de concluído. */
  em_andamento: boolean;
};

const BLOCO_CONSULTA = 500;

type DocBase = { id: string; numero: string; titulo: string; pasta_id: string | null; pasta_caminho: string | null; documento_original_id: string | null };
export type DocAnalisado = DocBase & { ver: boolean; motivos: MotivoBloqueio[]; versoes: number; bytes: number };

/** Fatos e permissão de cada documento (em blocos). Documentos inexistentes/de outro cliente simplesmente não voltam. */
export async function analisarDocumentos(ctx: CtxGed, ids: readonly string[]): Promise<DocAnalisado[]> {
  const out: DocAnalisado[] = [];
  for (const bloco of emBlocos(ids, BLOCO_CONSULTA)) {
    const docs = await ctx.db.gedDocumento.findMany({
      where: { id: { in: bloco } },
      select: {
        id: true, organizacao_id: true, numero: true, titulo: true, status: true, codigo_verificador: true, criado_por_id: true, pasta_id: true, sensibilidade: true, acl_propria: true,
        responsavel_id: true, setor_atual_id: true, documento_original_id: true, pasta: { select: { caminho_nome: true } },
      },
    });
    if (docs.length === 0) continue;
    const idsB = docs.map((d) => d.id);
    const [tram, com, sol, vers, anexos, comprovantes, acoes] = await Promise.all([
      ctx.db.gedTramite.groupBy({ by: ["documento_id"], where: { documento_id: { in: idsB } }, _count: { _all: true } }),
      ctx.db.gedComentario.groupBy({ by: ["documento_id"], where: { documento_id: { in: idsB } }, _count: { _all: true } }),
      ctx.db.gedSolicitacaoAssinatura.groupBy({ by: ["documento_id"], where: { documento_id: { in: idsB } }, _count: { _all: true } }),
      ctx.db.gedVersaoDocumento.findMany({ where: { documento_id: { in: idsB } }, select: { documento_id: true, selada: true, origem: true, tamanho: true } }),
      ctx.db.gedProtocoloDocumento.groupBy({ by: ["documento_id"], where: { documento_id: { in: idsB } }, _count: { _all: true } }),
      ctx.db.gedProtocolo.findMany({ where: { comprovante_documento_id: { in: idsB } }, select: { comprovante_documento_id: true } }),
      acoesDosDocumentos(ctx, docs as GedDocumentoMin[]),
    ]);
    const n = (g: { documento_id: string; _count: { _all: number } }[]) => new Map(g.map((x) => [x.documento_id, x._count._all]));
    const mTram = n(tram);
    const mCom = n(com);
    const mSol = n(sol);
    const mAnexo = n(anexos);
    const mCompr = new Map<string, number>();
    for (const c of comprovantes) if (c.comprovante_documento_id) mCompr.set(c.comprovante_documento_id, (mCompr.get(c.comprovante_documento_id) ?? 0) + 1);
    const porDoc = new Map<string, { n: number; selada: number; sistema: number; bytes: number }>();
    for (const v of vers) {
      const a = porDoc.get(v.documento_id) ?? { n: 0, selada: 0, sistema: 0, bytes: 0 };
      a.n++;
      a.bytes += v.tamanho;
      if (v.selada) a.selada++;
      if (v.origem === "SELO" || v.origem === "COMPROVANTE") a.sistema++;
      porDoc.set(v.documento_id, a);
    }
    for (const d of docs) {
      const a = acoes.get(d.id) ?? [];
      const ver = a.includes("VER");
      const v = porDoc.get(d.id) ?? { n: 0, selada: 0, sistema: 0, bytes: 0 };
      out.push({
        id: d.id, numero: d.numero, titulo: d.titulo, pasta_id: d.pasta_id, pasta_caminho: d.pasta?.caminho_nome ?? null, documento_original_id: d.documento_original_id, ver,
        versoes: v.n, bytes: v.bytes,
        motivos: motivosDeBloqueio({
          status: d.status, codigo_verificador: d.codigo_verificador, tramites: mTram.get(d.id) ?? 0, comentarios: mCom.get(d.id) ?? 0, solicitacoes: mSol.get(d.id) ?? 0,
          versoes_seladas: v.selada, versoes_sistema: v.sistema, protocolo_anexos: mAnexo.get(d.id) ?? 0, protocolo_comprovantes: mCompr.get(d.id) ?? 0,
          permitido: ver && a.includes("ADMINISTRAR"),
        }),
      });
    }
  }
  return out;
}

/** Derivadas (versões anonimizadas) de cada documento: original → derivadas. */
async function derivadasDe(ctx: CtxGed, ids: readonly string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  for (const bloco of emBlocos(ids, BLOCO_CONSULTA)) {
    const l = await ctx.db.gedDocumento.findMany({ where: { documento_original_id: { in: bloco } }, select: { id: true, documento_original_id: true } });
    for (const d of l) if (d.documento_original_id) m.set(d.documento_original_id, [...(m.get(d.documento_original_id) ?? []), d.id]);
  }
  return m;
}

// ───────────── Resolução do alvo ─────────────

type Resolvido = { rotulo: string; nome_pasta: string | null; doc_ids: string[]; pastas: PastaCandidata[] };

async function idsDocumentosDasPastas(ctx: CtxGed, pastaIds: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const bloco of emBlocos(pastaIds, 1000)) {
    let cursor: string | undefined;
    for (;;) {
      const l = await ctx.db.gedDocumento.findMany({ where: { pasta_id: { in: bloco } }, select: { id: true }, orderBy: { id: "asc" }, take: 5000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      out.push(...l.map((d) => d.id));
      if (l.length < 5000) break;
      cursor = l[l.length - 1].id;
    }
  }
  return out;
}

async function resolverPasta(ctx: CtxGed, id: string): Promise<Resolvido> {
  await exigirPasta(ctx, id, "ADMINISTRAR");
  const raiz = exigirEncontrado(await ctx.db.gedPasta.findUnique({ where: { id }, select: { nome: true, caminho_nome: true } }), "Pasta não encontrada.");
  const sub = await ctx.db.gedPasta.findMany({ where: { caminho_ids: { has: id } }, select: { id: true, parent_id: true, caminho_ids: true } });
  const pastas: PastaCandidata[] = sub.map((p) => ({ id: p.id, parent_id: p.parent_id, profundidade: p.caminho_ids.length }));
  return { rotulo: raiz.caminho_nome, nome_pasta: raiz.nome, doc_ids: await idsDocumentosDasPastas(ctx, pastas.map((p) => p.id)), pastas };
}

async function resolverDocumento(ctx: CtxGed, id: string): Promise<Resolvido> {
  await exigirDocumento(ctx, id, "VER");
  const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id }, select: { numero: true } }), "Documento não encontrado.");
  return { rotulo: d.numero, nome_pasta: null, doc_ids: [id], pastas: [] };
}

export const STATUS_LOTE_EM_ANDAMENTO = ["RECEBENDO", "PENDENTE", "PROCESSANDO"] as const;

async function resolverLote(ctx: CtxGed, id: string): Promise<Resolvido & { lote_em_andamento: boolean }> {
  if (!podeImportarGed(ctx)) throw proibido("Somente administradores e gestores acessam as importações.");
  const lote = exigirEncontrado(await ctx.db.gedImportacao.findFirst({ where: { AND: [{ id }, whereVisiveis(ctx)] } }), "Importação não encontrada.");
  const emAndamento = (STATUS_LOTE_EM_ANDAMENTO as readonly string[]).includes(lote.status);
  const docIds: string[] = [];
  for (let page = 0; ; page++) {
    const l = await ctx.db.gedImportacaoItem.findMany({ where: { importacao_id: id, status: "IMPORTADO", documento_id: { not: null } }, select: { documento_id: true }, orderBy: { ordem: "asc" }, skip: page * 5000, take: 5000 });
    docIds.push(...l.flatMap((i) => (i.documento_id ? [i.documento_id] : [])));
    if (l.length < 5000) break;
  }
  // pastas candidatas: ancestrais-ou-próprias das pastas dos itens, criadas a partir do início do lote, abaixo do destino
  const pastaItens = (await ctx.db.gedImportacaoItem.groupBy({ by: ["pasta_id"], where: { importacao_id: id, pasta_id: { not: null } } })).flatMap((g) => (g.pasta_id ? [g.pasta_id] : []));
  const base: { id: string; caminho_ids: string[] }[] = [];
  for (const bloco of emBlocos(pastaItens, 1000)) base.push(...(await ctx.db.gedPasta.findMany({ where: { id: { in: bloco } }, select: { id: true, caminho_ids: true } })));
  const todas: { id: string; parent_id: string | null; caminho_ids: string[]; created_at: Date }[] = [];
  for (const bloco of emBlocos(ancestraisOuProprias(base), 1000)) todas.push(...(await ctx.db.gedPasta.findMany({ where: { id: { in: bloco } }, select: { id: true, parent_id: true, caminho_ids: true, created_at: true } })));
  const destino = lote.pasta_destino_id ? await ctx.db.gedPasta.findUnique({ where: { id: lote.pasta_destino_id }, select: { id: true, caminho_ids: true } }) : null;
  const criadas = new Set(pastasCriadasPeloLote(todas, { id: destino?.id ?? null, caminho_ids: destino?.caminho_ids ?? [] }, lote.created_at));
  const pastas: PastaCandidata[] = todas.filter((p) => criadas.has(p.id)).map((p) => ({ id: p.id, parent_id: p.parent_id, profundidade: p.caminho_ids.length }));
  return { rotulo: lote.nome_arquivo, nome_pasta: null, doc_ids: [...new Set(docIds)], pastas, lote_em_andamento: emAndamento };
}

// ───────────── Pastas que podem sair ─────────────

/**
 * Pastas candidatas OCUPADAS: com documento que continua (descontados os que serão excluídos: `removidosPorPasta`), com subpasta
 * fora das candidatas ou sem permissão Administrar para o usuário.
 */
async function pastasOcupadas(ctx: CtxGed, cands: readonly PastaCandidata[], removidosPorPasta: ReadonlyMap<string, number>): Promise<Set<string>> {
  const ocupadas = new Set<string>();
  const candSet = new Set(cands.map((c) => c.id));
  const permissao = await whereGedPastas(ctx, "ADMINISTRAR");
  for (const bloco of emBlocos([...candSet], 1000)) {
    const docs = await ctx.db.gedDocumento.groupBy({ by: ["pasta_id"], where: { pasta_id: { in: bloco } }, _count: { _all: true } });
    for (const d of docs) if (d.pasta_id && d._count._all > (removidosPorPasta.get(d.pasta_id) ?? 0)) ocupadas.add(d.pasta_id);
    const filhas = await ctx.db.gedPasta.findMany({ where: { parent_id: { in: bloco } }, select: { id: true, parent_id: true } });
    for (const f of filhas) if (f.parent_id && !candSet.has(f.id)) ocupadas.add(f.parent_id);
    const ok = new Set((await ctx.db.gedPasta.findMany({ where: { AND: [{ id: { in: bloco } }, permissao] }, select: { id: true } })).map((p) => p.id));
    for (const id of bloco) if (!ok.has(id)) ocupadas.add(id);
  }
  return ocupadas;
}

/** Pastas removíveis AGORA (documentos já excluídos): usada pelo executor depois dos documentos. */
export async function pastasRemoviveisAgora(ctx: CtxGed, cands: readonly PastaCandidata[]): Promise<PastaCandidata[]> {
  if (cands.length === 0) return [];
  return pastasRemoviveis(cands, await pastasOcupadas(ctx, cands, new Map()));
}

// ───────────── Plano ─────────────

/** O plano não depende do modo: sempre separa o que sai do que fica (quem decide é `decidirPlano`, conforme tudo-ou-nada × apenas os que podem). */
export async function planejarExclusao(ctx: CtxGed, alvo: AlvoExclusao): Promise<PlanoInterno> {
  let loteEmAndamento = false;
  let r: Resolvido;
  if (alvo.tipo === "DOCUMENTO") r = await resolverDocumento(ctx, alvo.id);
  else if (alvo.tipo === "PASTA") r = await resolverPasta(ctx, alvo.id);
  else {
    const l = await resolverLote(ctx, alvo.id);
    loteEmAndamento = l.lote_em_andamento;
    r = l;
  }
  if (loteEmAndamento) {
    // Lote ainda recebendo/processando: nada a planejar (a exclusão do conteúdo só vale depois de concluído).
    const vazio = montarPublico(alvo, r, [], [], [], 0, 0, [], true);
    return { publico: vazio, excluiveis: [], pastas_removiveis: [], pastas_candidatas: [], nome_pasta: r.nome_pasta, em_andamento: true };
  }

  const analisados = await analisarDocumentos(ctx, r.doc_ids);
  const bloqueios = new Map<string, MotivoBloqueio[]>(analisados.map((d) => [d.id, [...d.motivos]]));
  propagarDerivados(analisados.map((d) => d.id), await derivadasDe(ctx, analisados.map((d) => d.id)), bloqueios);
  const excluiveisDocs = ordenarParaExclusao(analisados.filter((d) => (bloqueios.get(d.id)?.length ?? 0) === 0));
  const removidosPorPasta = new Map<string, number>();
  for (const d of excluiveisDocs) if (d.pasta_id) removidosPorPasta.set(d.pasta_id, (removidosPorPasta.get(d.pasta_id) ?? 0) + 1);
  const removiveis = r.pastas.length ? pastasRemoviveis(r.pastas, await pastasOcupadas(ctx, r.pastas, removidosPorPasta)) : [];
  const bloqueadosDocs = analisados.filter((d) => (bloqueios.get(d.id)?.length ?? 0) > 0).map((d) => ({ d, motivos: bloqueios.get(d.id)! }));

  const publico = montarPublico(alvo, r, excluiveisDocs, bloqueadosDocs, removiveis, excluiveisDocs.reduce((a, d) => a + d.versoes, 0), excluiveisDocs.reduce((a, d) => a + d.bytes, 0), r.pastas, false);
  return { publico, excluiveis: excluiveisDocs.map((d) => d.id), pastas_removiveis: removiveis.map((p) => p.id), pastas_candidatas: r.pastas, nome_pasta: r.nome_pasta, em_andamento: false };
}

function montarPublico(
  alvo: AlvoExclusao,
  r: Resolvido,
  excluiveis: DocAnalisado[],
  bloqueados: { d: DocAnalisado; motivos: MotivoBloqueio[] }[],
  removiveis: PastaCandidata[],
  versoes: number,
  bytes: number,
  pastas: readonly PastaCandidata[],
  loteEmAndamento: boolean,
): PlanoExclusaoPublico {
  // Documento que o usuário nem enxerga: só contado (nunca número/título). Os demais impeditivos vêm identificados.
  const invisiveis = bloqueados.filter((b) => !b.d.ver);
  const visiveis = bloqueados.filter((b) => b.d.ver);
  const lista: DocumentoBloqueado[] = visiveis.slice(0, MAX_BLOQUEADOS_LISTADOS).map((b) => ({ id: b.d.id, numero: b.d.numero, titulo: b.d.titulo, pasta: b.d.pasta_caminho, motivos: b.motivos }));
  const motivos = contarMotivos(bloqueados.map((b) => ({ motivos: b.motivos })));
  return {
    alvo: { tipo: alvo.tipo, id: alvo.id, rotulo: r.rotulo },
    confirmacao_esperada: confirmacaoEsperada(alvo.tipo, r.nome_pasta),
    documentos_total: excluiveis.length + bloqueados.length,
    documentos_excluiveis: excluiveis.length,
    versoes,
    bytes,
    pastas_total: pastas.length,
    pastas_removiveis: removiveis.length,
    bloqueados_total: bloqueados.length,
    sem_permissao_total: invisiveis.length,
    bloqueados: lista,
    motivos,
    sincrono: modoSincrono(excluiveis.length, removiveis.length),
    mensagem_bloqueio: loteEmAndamento
      ? "Esta importação ainda está em andamento. Aguarde a conclusão (ou cancele o envio) antes de excluir o conteúdo."
      : bloqueados.length > 0 ? mensagemBloqueio(bloqueados.length, motivos) : null,
  };
}
