// Baixar pasta como ZIP (docs/ged.md §15): pasta + TODAS as subpastas visíveis, preservando a árvore, STORE (PDF não comprime),
// em STREAMING (um arquivo por vez na memória; ZIP64 automático) e com MANIFESTO.csv + LEIAME.txt ao final.
//
// Segurança: tudo passa por ctx.db (cliente isolado) e pelos filtros de permissão do GED – pasta que o usuário não vê → 404;
// documento sem VER (ou em subpasta sem VER) NÃO entra e aparece no manifesto como "omitido: sem permissao" SEM título/número.
// "Baixar" = mesma permissão de VER (modelo atual: lib/ged/permissoes.ts); o teto do papel já vale em whereGedVisivel.
import { Readable } from "node:stream";
import type { Prisma } from "@prisma/client";
import { invalido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { exigirPasta, whereGedPastasVisiveis, whereGedVisivel } from "../permissoes";
import { lerArquivoGed } from "../storage";
import {
  ajustarAoCaminhoMaximo, Desambiguador, LIMITE_ARQUIVOS_ZIP, linhaOmitida, montarLeiame, montarManifesto, nomeArquivoZip, precisaZip64,
  sanitizarSegmento, verificarLimiteArquivos, type LinhaManifesto,
} from "./regras";

export type ModoVersao = "atual" | "original";

export type EntradaPlano = {
  zipPath: string;
  documento_id: string;
  versao_id: string;
  storage_key: string;
  data: Date;
  linha: LinhaManifesto;
};

export type PlanoExportacao = {
  pasta: { id: string; nome: string; caminho_nome: string };
  nomeZip: string;
  /** Diretório raiz dentro do ZIP (nome da pasta sanitizado). */
  zipRaiz: string;
  modo: ModoVersao;
  entradas: EntradaPlano[];
  /** Linhas já definitivas (omitidos/sem arquivo); as das `entradas` ganham o resultado ao serem lidas. */
  linhasFixas: LinhaManifesto[];
  totalBytes: number;
  omitidos: number;
};

const TAM_LOTE = 1000;
const ORIGENS_UPLOAD = new Set(["UPLOAD", "SCAN"]);
const dataCurta = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "");

export function rotuloSituacaoAssinatura(status: string, selada: boolean): string {
  if (selada || status === "ASSINADO") return "assinado (PDF selado)";
  if (status === "EM_ASSINATURA") return "em assinatura";
  if (status === "RECUSADO") return "assinatura recusada";
  return "sem assinatura";
}

type VersaoMin = { id: string; documento_id: string; n: number; origem: string; derivada_de_id: string | null; storage_key: string; nome_arquivo: string; mime: string; tamanho: number; sha256: string; paginas: number | null; selada: boolean; created_at: Date };

/** PURA: escolhe a versão a exportar. Assinado/selado → sempre a vigente (selada). `original` troca OCR pela versão-base. */
export function escolherVersao(
  doc: { versao_atual_id: string | null; status: string },
  versoes: VersaoMin[],
  modo: ModoVersao,
): VersaoMin | null {
  const atual = versoes.find((v) => v.id === doc.versao_atual_id) ?? null;
  if (!atual) return null;
  if (modo === "original" && atual.origem === "OCR" && !atual.selada && doc.status !== "ASSINADO" && atual.derivada_de_id) {
    return versoes.find((v) => v.id === atual.derivada_de_id) ?? atual;
  }
  return atual;
}

/** PURA: nome do arquivo = nome original do envio (UPLOAD/SCAN mais recente até a versão escolhida); senão o número do documento. */
export function nomeDoArquivo(numero: string, escolhida: VersaoMin, versoes: VersaoMin[]): string {
  const envios = versoes.filter((v) => ORIGENS_UPLOAD.has(v.origem)).sort((a, b) => a.n - b.n);
  const fonte = [...envios].reverse().find((v) => v.n <= escolhida.n) ?? envios[0] ?? (ORIGENS_UPLOAD.has(escolhida.origem) ? escolhida : null);
  const bruto = fonte?.nome_arquivo?.trim() || numero;
  return /\.[A-Za-z0-9]{1,8}$/.test(bruto) ? bruto : `${bruto}.pdf`;
}

export async function planejarExportacaoPasta(ctx: CtxGed, pastaId: string, opc: { modo?: ModoVersao; limite?: number } = {}): Promise<PlanoExportacao> {
  const modo: ModoVersao = opc.modo === "original" ? "original" : "atual";
  const { pasta: min } = await exigirPasta(ctx, pastaId, "VER"); // 404 se outro cliente/sem VER
  const raiz = exigirEncontrado(await ctx.db.gedPasta.findUnique({ where: { id: min.id }, select: { id: true, nome: true, caminho_nome: true } }), "Pasta não encontrada.");

  // Árvore: TODAS as subpastas (para contar omitidos) × as visíveis (que viram diretórios do ZIP)
  const todas = await ctx.db.gedPasta.findMany({ where: { caminho_ids: { has: raiz.id }, excluido_em: null }, select: { id: true, parent_id: true, nome: true, caminho_ids: true } });
  const visiveis = new Set((await ctx.db.gedPasta.findMany({ where: { AND: [{ id: { in: todas.map((p) => p.id) } }, await whereGedPastasVisiveis(ctx)] }, select: { id: true } })).map((p) => p.id));
  const des = new Desambiguador();
  const dirPorPasta = new Map<string, string>();
  const nomeRaiz = des.reservar("", sanitizarSegmento(raiz.nome));
  dirPorPasta.set(raiz.id, nomeRaiz);
  for (const p of [...todas].sort((a, b) => a.caminho_ids.length - b.caminho_ids.length || a.nome.localeCompare(b.nome, "pt-BR"))) {
    if (p.id === raiz.id || !visiveis.has(p.id) || !p.parent_id) continue;
    const dirPai = dirPorPasta.get(p.parent_id);
    if (dirPai === undefined) continue; // pai invisível/omitido: a subárvore não entra
    dirPorPasta.set(p.id, `${dirPai}/${des.reservar(dirPai, sanitizarSegmento(p.nome))}`);
  }
  const pastasIncluidas = [...dirPorPasta.keys()];

  const baseDoc: Prisma.GedDocumentoWhereInput = { excluido_em: null, status: { not: "ARQUIVADO" } };
  const visivel = await whereGedVisivel(ctx, "VER");
  const whereInclui: Prisma.GedDocumentoWhereInput = { AND: [visivel, baseDoc, { pasta_id: { in: pastasIncluidas } }] };

  const total = await ctx.db.gedDocumento.count({ where: whereInclui });
  const lim = verificarLimiteArquivos(total, opc.limite ?? LIMITE_ARQUIVOS_ZIP);
  if (!lim.ok) throw invalido(lim.mensagem);

  // Omitidos = documentos da árvore (qualquer subpasta) − os que entram. Diferença de contagens por pasta (não use NOT sobre o
  // filtro de permissão: com colunas NULL o SQL devolve NULL e a linha some). Só contagem: nada de título/número.
  const [totaisPorPasta, incluidosPorPasta] = await Promise.all([
    ctx.db.gedDocumento.groupBy({ by: ["pasta_id"], where: { AND: [baseDoc, { pasta_id: { in: todas.map((p) => p.id) } }] }, _count: { _all: true } }),
    ctx.db.gedDocumento.groupBy({ by: ["pasta_id"], where: whereInclui, _count: { _all: true } }),
  ]);
  const incl = new Map(incluidosPorPasta.map((g) => [g.pasta_id, g._count._all]));
  const omitidosPorPasta = totaisPorPasta.map((g) => ({ pasta_id: g.pasta_id, qtd: g._count._all - (incl.get(g.pasta_id) ?? 0) })).filter((g) => g.qtd > 0);
  const linhasFixas: LinhaManifesto[] = [];
  let omitidos = 0;
  for (const o of omitidosPorPasta) {
    const dir = o.pasta_id ? dirPorPasta.get(o.pasta_id) : undefined;
    for (let i = 0; i < o.qtd; i++) linhasFixas.push(linhaOmitida(dir ?? "(pasta sem acesso)"));
    omitidos += o.qtd;
  }

  const docs = await ctx.db.gedDocumento.findMany({
    where: whereInclui,
    select: { id: true, pasta_id: true, numero: true, titulo: true, data_documento: true, status: true, versao_atual_id: true, created_at: true, tipo: { select: { nome: true } } },
    orderBy: [{ numero: "asc" }],
  });
  docs.sort((a, b) => (dirPorPasta.get(a.pasta_id ?? "") ?? "").localeCompare(dirPorPasta.get(b.pasta_id ?? "") ?? "", "pt-BR") || a.numero.localeCompare(b.numero));

  const entradas: EntradaPlano[] = [];
  let totalBytes = 0;
  for (let i = 0; i < docs.length; i += TAM_LOTE) {
    const lote = docs.slice(i, i + TAM_LOTE);
    const versoes = await ctx.db.gedVersaoDocumento.findMany({
      where: { documento_id: { in: lote.map((d) => d.id) } },
      select: { id: true, documento_id: true, n: true, origem: true, derivada_de_id: true, storage_key: true, nome_arquivo: true, mime: true, tamanho: true, sha256: true, paginas: true, selada: true, created_at: true },
    });
    const porDoc = new Map<string, VersaoMin[]>();
    for (const v of versoes) (porDoc.get(v.documento_id) ?? porDoc.set(v.documento_id, []).get(v.documento_id)!).push(v);
    for (const d of lote) {
      const dir = dirPorPasta.get(d.pasta_id ?? "") ?? nomeRaiz;
      const vs = porDoc.get(d.id) ?? [];
      const esc = escolherVersao(d, vs, modo);
      const base: LinhaManifesto = {
        caminho: dir, numero: d.numero, titulo: d.titulo, tipo: d.tipo?.nome ?? "", data_documento: dataCurta(d.data_documento), situacao_documento: d.status,
        assinatura: rotuloSituacaoAssinatura(d.status, esc?.selada ?? false), versao: "", sha256: "", tamanho: null, paginas: null, situacao: "incluido",
      };
      if (!esc) {
        linhasFixas.push({ ...base, situacao: "omitido: sem arquivo" });
        continue;
      }
      const nome = ajustarAoCaminhoMaximo(dir, des.reservar(dir, sanitizarSegmento(nomeDoArquivo(d.numero, esc, vs), { arquivo: true }), true));
      const zipPath = `${dir}/${nome}`;
      totalBytes += esc.tamanho;
      entradas.push({
        zipPath, documento_id: d.id, versao_id: esc.id, storage_key: esc.storage_key, data: d.created_at,
        linha: { ...base, caminho: zipPath, versao: `v${esc.n} (${esc.origem})`, sha256: esc.sha256, tamanho: esc.tamanho, paginas: esc.paginas },
      });
    }
  }
  return { pasta: { id: raiz.id, nome: raiz.nome, caminho_nome: raiz.caminho_nome }, nomeZip: nomeArquivoZip(raiz.nome), zipRaiz: nomeRaiz, modo, entradas, linhasFixas, totalBytes, omitidos };
}

/**
 * Stream do ZIP. Um arquivo por vez: a próxima entrada só é anexada quando a anterior foi escrita (contrapressão) – memória
 * ~ maior arquivo (≤ 25 MB) independentemente do total. Falha ao ler um arquivo NÃO derruba o ZIP: a linha do manifesto vira
 * "erro: …". MANIFESTO.csv e LEIAME.txt vão ao final (refletem o resultado real). Auditoria (resumo + BAIXAR por documento) no fim,
 * inclusive se o cliente cancelar (registra o que foi entregue).
 */
export async function criarStreamZip(ctx: CtxGed, plano: PlanoExportacao): Promise<Readable> {
  const { ZipArchive } = await import("archiver");
  const zip = new ZipArchive({ store: true, forceZip64: precisaZip64(plano.totalBytes, plano.entradas.length + 2) });
  const iniciadoEm = new Date();
  const incluidos: EntradaPlano[] = [];
  const linhas: LinhaManifesto[] = [];
  let bytes = 0;
  let abortado = false;
  let concluido = false;
  zip.once("close", () => {
    if (!concluido) abortado = true; // cliente cancelou/conexão caiu
  });
  zip.on("error", (e) => console.error("[ged] exportação de pasta: erro no ZIP", e.message));

  const anexar = (conteudo: Buffer | string, name: string, date: Date) =>
    new Promise<void>((resolve) => {
      const fim = () => {
        zip.off("entry", fim);
        zip.off("close", fim);
        zip.off("error", fim);
        resolve();
      };
      zip.once("entry", fim);
      zip.once("close", fim); // cancelado: não deixa a rotina pendurada
      zip.once("error", fim);
      zip.append(typeof conteudo === "string" ? Buffer.from(conteudo, "utf8") : conteudo, { name, store: true, date });
    });

  void (async () => {
    try {
      for (const e of plano.entradas) {
        if (abortado) return;
        try {
          const dados = await lerArquivoGed(ctx.organizacao_id, e.storage_key);
          if (abortado) return;
          await anexar(dados, e.zipPath, e.data);
          incluidos.push(e);
          bytes += dados.length;
          linhas.push(e.linha);
        } catch (err) {
          console.error("[ged] exportação de pasta: arquivo ilegível", e.versao_id, err instanceof Error ? err.message : err);
          linhas.push({ ...e.linha, sha256: "", tamanho: null, situacao: "erro: arquivo nao encontrado no armazenamento" });
        }
      }
      if (abortado) return;
      const todas = [...linhas, ...plano.linhasFixas];
      const raiz = plano.zipRaiz;
      await anexar(montarManifesto(todas), `${raiz}/MANIFESTO.csv`, iniciadoEm);
      await anexar(
        montarLeiame({
          pasta: plano.pasta.caminho_nome, organizacao: ctx.organizacao.nome, exportadoPor: ctx.usuario.nome, geradoEm: iniciadoEm,
          incluidos: incluidos.length, omitidos: plano.omitidos + plano.linhasFixas.filter((l) => l.situacao === "omitido: sem arquivo").length,
          erros: linhas.filter((l) => l.situacao.startsWith("erro")).length, bytes, modoVersao: plano.modo,
        }),
        `${raiz}/LEIAME.txt`,
        iniciadoEm,
      );
      concluido = true;
      await zip.finalize();
    } catch (err) {
      console.error("[ged] exportação de pasta falhou", err instanceof Error ? err.message : err);
      abortado = true;
      zip.destroy(err instanceof Error ? err : new Error(String(err)));
    } finally {
      await registrarExportacao(ctx, plano, incluidos, bytes, abortado);
    }
  })();
  return zip;
}

/** Auditoria: um evento resumo + um acesso BAIXAR por documento entregue (createMany em lotes). Nunca derruba o download. */
async function registrarExportacao(ctx: CtxGed, plano: PlanoExportacao, incluidos: EntradaPlano[], bytes: number, interrompida: boolean) {
  try {
    await auditarGed(ctx, {
      acao: "GED_PASTA_EXPORTADA_ZIP",
      entidade: "ged_pasta",
      entidade_id: plano.pasta.id,
      depois: { pasta: plano.pasta.caminho_nome, modo_versao: plano.modo, documentos: incluidos.length, omitidos: plano.omitidos, bytes, interrompida },
    });
    for (let i = 0; i < incluidos.length; i += 1000) {
      await ctx.db.gedAcessoLog.createMany({
        data: incluidos.slice(i, i + 1000).map((e) => ({ usuario_id: ctx.usuario.id, documento_id: e.documento_id, versao_id: e.versao_id, acao: "BAIXAR", ip: null, user_agent: "exportacao-pasta-zip" }) as Prisma.GedAcessoLogCreateManyInput),
      });
    }
  } catch (e) {
    console.error("[ged] falha ao registrar exportação de pasta:", e instanceof Error ? e.message : e);
  }
}
