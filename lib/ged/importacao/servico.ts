// Importação em lote (GED fase 2, v2). A estrutura de pastas (do ZIP ou da pasta enviada) vira a árvore de pastas do GED.
//
//   criarImportacao ........ (API/tela) ZIP pequeno de uma vez: valida (limites), grava e registra o lote PENDENTE
//   envio.ts ............... v2: pasta arquivo a arquivo e ZIP grande em partes (lote RECEBENDO → concluir → PENDENTE)
//   executarImportacao ..... (job ged-importar, ou inline sem worker) processa item a item; retomável (itens já gravados são pulados).
//                            O ZIP é remontado em DISCO TEMPORÁRIO e lido por posição (nunca inteiro na memória); ZIPs aninhados
//                            são extraídos em fluxo para disco e expandidos como pasta (ou ignorados se a pasta irmã já existe)
//   listar/obter/itens ..... consulta do lote e do relatório
//
// Regras: papel com `importar` (Admin/Gestor); pastas criadas via criarPasta() (EDITAR no pai); documentos via
// criarDocumentoUpload() (origem UPLOAD, EDITAR na pasta, ACL do criador, número, versão 1, auditoria, texto);
// a visibilidade vem da ACL herdada da pasta de destino. Duplicado = mesmo sha256 já existente na organização (documento
// não excluído) → pulado e relatado. Cada arquivo é independente: falha de um vira item ERRO, o lote continua.
// Tudo via gedDb(organizacao_id); nenhum SQL cru.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type GedSensibilidade, type GedStatusItemImportacao } from "@prisma/client";
import { ZodError } from "zod";
import { ErroApi, invalido, proibido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import { exigirEncontrado, gedDb, type GedDb } from "../db";
import { ctxGedPorUsuarioId, type CtxGed } from "../escopo";
import { podeImportarGed } from "../papeis";
import { criarPasta } from "../pastas";
import { exigirPasta, whereGedVisivel } from "../permissoes";
import { validarUploadGed } from "../storage";
import { zSensibilidade, zUuid } from "../tipos";
import { criarDocumentoUpload } from "../documentos/servico";
import { sha256Hex } from "../documentos/versoes";
import { chaveZipImportacao, lerArquivoPasta, limparTemporarios, montarZipLocal, pastaTrabalhoLocal, removerArquivoPasta, removerPartesZip, removerZipImportacao, salvarZipImportacao } from "./arquivo";
import { ehZip, MOTIVO_ZIP_DUPLICADO, nomeBaseZip, normalizarCaminho, unirPastasRepetidas } from "./caminhos";
import { LIMITES_PADRAO, MAX_ZIP_SIMPLES, PRAZO_LOTE_ABANDONADO_MS, type LimitesZip } from "./limites";
import { tituloDoArquivo } from "./nomes";
import { ErroZip, extrairEntradaDisco, extrairEntradaParaArquivo, lerDiretorioZip, lerDiretorioZipDisco, planejarZip, ZipDisco } from "./zip";

const ID_NULO = "00000000-0000-0000-0000-000000000000";
/** Lotes ativos (recebendo/pendentes/processando) por cliente ao mesmo tempo. */
export const MAX_LOTES_ATIVOS = 3;
/** Um lote PROCESSANDO sem sinal de vida por este tempo é retomado (worker caiu). */
export const STALE_MS = 10 * 60 * 1000;
/** Lote RECEBENDO sem atividade há mais que isso deixa de ocupar vaga (continua retomável até ser descartado, em 3 dias). */
const RECEBENDO_ATIVO_MS = 2 * 3600 * 1000;

const ehUuid = (v: unknown): v is string => zUuid.safeParse(v).success;

export type EntradaImportacao = {
  nome_arquivo: string;
  arquivo: Buffer;
  pasta_id?: string | null;
  tipo_id?: string | null;
  sensibilidade?: string | null;
  unir_pastas?: boolean;
};

export type DestinoImportacao = { pasta_id?: string | null; tipo_id?: string | null; sensibilidade?: string | null };

/** Valida pasta de destino (EDITAR), tipo e sensibilidade do lote. Pasta/tipo de outro cliente = 404/422. */
export async function validarDestino(ctx: CtxGed, e: DestinoImportacao): Promise<{ pastaId: string | null; tipoId: string | null; sensibilidade: GedSensibilidade }> {
  const pastaId = e.pasta_id || null;
  let sensibilidade: GedSensibilidade;
  if (pastaId) {
    if (!ehUuid(pastaId)) throw invalido("Pasta de destino inválida.");
    await exigirPasta(ctx, pastaId, "EDITAR");
    const p = exigirEncontrado(await ctx.db.gedPasta.findUnique({ where: { id: pastaId }, select: { sensibilidade_padrao: true, excluido_em: true } }), "Pasta de destino não encontrada.");
    if (p.excluido_em) throw invalido("A pasta de destino está arquivada.");
    sensibilidade = zSensibilidade.catch(p.sensibilidade_padrao).parse(e.sensibilidade || undefined);
  } else {
    const s = zSensibilidade.safeParse(e.sensibilidade || "RESTRITO");
    if (!s.success) throw invalido("Sensibilidade inválida.");
    sensibilidade = s.data;
  }
  const tipoId = e.tipo_id || null;
  if (tipoId) {
    if (!ehUuid(tipoId)) throw invalido("Tipo de documento inválido.");
    if (!(await ctx.db.gedTipoDocumento.findUnique({ where: { id: tipoId }, select: { id: true } }))) throw invalido("Tipo de documento não encontrado.");
  }
  return { pastaId, tipoId, sensibilidade };
}

/** 429 se o cliente já tem lotes demais em andamento. */
export async function exigirVagaLote(ctx: CtxGed): Promise<void> {
  const parado = new Date(Date.now() - RECEBENDO_ATIVO_MS);
  const ativos = await ctx.db.gedImportacao.count({ where: { OR: [{ status: { in: ["PENDENTE", "PROCESSANDO"] } }, { status: "RECEBENDO", updated_at: { gt: parado } }] } });
  if (ativos >= MAX_LOTES_ATIVOS) throw new ErroApi(429, "MUITAS_IMPORTACOES", `Já há ${ativos} importações em andamento. Aguarde a conclusão para enviar outra.`);
}

export function exigirPodeImportar(ctx: CtxGed): void {
  if (!podeImportarGed(ctx)) throw proibido("Somente administradores e gestores podem importar.");
}

// ───────────── Criar (ZIP pequeno, de uma vez) ─────────────

export async function criarImportacao(ctx: CtxGed, e: EntradaImportacao, limites: LimitesZip = LIMITES_PADRAO): Promise<{ id: string; status: "PENDENTE" }> {
  exigirPodeImportar(ctx);
  const nome = (e.nome_arquivo ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  if (!/\.zip$/i.test(nome)) throw invalido("Envie um arquivo ZIP (.zip).");
  if (!e.arquivo || e.arquivo.length === 0) throw invalido("Arquivo vazio.");
  if (e.arquivo.length > MAX_ZIP_SIMPLES && limites === LIMITES_PADRAO) throw invalido(`Este envio aceita ZIP de até ${Math.round(MAX_ZIP_SIMPLES / 1048576)} MB; ZIPs maiores são enviados em partes (a tela faz isso sozinha).`);
  const sig = e.arquivo.subarray(0, 4).toString("latin1");
  if (sig !== "PK\x03\x04" && sig !== "PK\x05\x06") throw invalido("O arquivo não é um ZIP válido.");

  let candidatos = 0;
  try {
    const plano = planejarZip(lerDiretorioZip(e.arquivo, limites), limites);
    candidatos = plano.itens.filter((i) => !i.previo).length;
  } catch (err) {
    if (err instanceof ErroZip) throw invalido(err.message);
    throw err;
  }
  if (candidatos === 0) throw invalido("O ZIP não contém nenhum PDF para importar (outros formatos e arquivos ocultos são ignorados).");

  const { pastaId, tipoId, sensibilidade } = await validarDestino(ctx, e);
  await exigirVagaLote(ctx);

  const id = randomUUID();
  const key = chaveZipImportacao(ctx.organizacao_id, id);
  await salvarZipImportacao(ctx.organizacao_id, id, e.arquivo);
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.gedImportacao.create({
        data: {
          id,
          criado_por_id: ctx.usuario.id,
          nome_arquivo: nome.slice(0, 250),
          tamanho_zip: e.arquivo.length,
          sha256_zip: sha256Hex(e.arquivo),
          storage_key: key,
          pasta_destino_id: pastaId,
          tipo_id: tipoId,
          sensibilidade,
          unir_pastas: !!e.unir_pastas,
        } as Prisma.GedImportacaoUncheckedCreateInput,
      });
      await auditarGed(ctx, { acao: "GED_IMPORTACAO_CRIADA", entidade: "ged_importacao", entidade_id: id, depois: { origem: "ZIP", nome_arquivo: nome, tamanho: e.arquivo.length, pasta_destino_id: pastaId, tipo_id: tipoId, sensibilidade, unir_pastas: !!e.unir_pastas } }, tx);
    });
  } catch (err) {
    await removerZipImportacao(ctx.organizacao_id, key).catch(() => {});
    throw err;
  }
  return { id, status: "PENDENTE" };
}

/** Chamar DEPOIS do commit: sem worker no ar, processa em segundo plano no próprio processo web (mesmo critério do texto). */
export async function iniciarImportacaoAposEnvio(organizacaoId: string, id: string): Promise<"worker" | "inline"> {
  let viaWorker = false;
  try {
    const { workerNoAr } = await import("@/lib/agente/ingestao");
    viaWorker = process.env.GED_IMPORTACAO_INLINE !== "true" && (await workerNoAr());
  } catch {
    viaWorker = false;
  }
  if (!viaWorker) void executarImportacao(organizacaoId, id).catch((e) => console.error("[ged-importar] inline", e));
  return viaWorker ? "worker" : "inline";
}

// ───────────── Executar ─────────────

export type ResultadoExecucao = "CONCLUIDA" | "CONCLUIDA_COM_ERROS" | "FALHOU" | "IGNORADA";
type Tally = Record<GedStatusItemImportacao, number>;
type Lote = Prisma.GedImportacaoGetPayload<object>;

/** Estado do processamento de um lote (um por execução). */
type Est = {
  db: GedDb;
  ctx: CtxGed;
  imp: Lote;
  organizacaoId: string;
  limites: LimitesZip;
  tally: Tally;
  pastasCriadas: number;
  cache: Map<string, string | Error>;
  /** Próxima `ordem` livre para itens criados durante a execução (ZIPs aninhados). */
  proxOrdem: number;
  /** Arquivos conhecidos no lote (inclui os expandidos de ZIPs aninhados) – teto global de maxArquivos. */
  totalArquivos: number;
  trabalho: string;
  contadorTmp: number;
};

function motivoDoErro(e: unknown): string {
  if (e instanceof ErroApi) return e.status === 404 ? "Registro não encontrado." : e.message;
  if (e instanceof ErroZip) return e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Dados inválidos.";
  console.error("[ged-importar] item", e);
  return "Falha inesperada ao importar o arquivo.";
}

async function resolverPasta(ctx: CtxGed, destino: string | null, sens: GedSensibilidade, segs: string[], cache: Map<string, string | Error>, onCriada: () => void): Promise<string | null> {
  let pai = destino;
  for (let i = 0; i < segs.length; i++) {
    const chave = segs.slice(0, i + 1).join("/").toLowerCase();
    const memo = cache.get(chave);
    if (memo instanceof Error) throw memo;
    if (memo) {
      pai = memo;
      continue;
    }
    try {
      const achar = () => ctx.db.gedPasta.findFirst({ where: { parent_id: pai, nome: { equals: segs[i], mode: "insensitive" } }, select: { id: true, excluido_em: true } });
      let existente = await achar();
      if (existente?.excluido_em) throw invalido(`A pasta "${segs[i]}" existe, mas está arquivada. Restaure-a ou renomeie no ZIP.`);
      if (!existente) {
        try {
          const r = await criarPasta(ctx, { nome: segs[i], parent_id: pai, sensibilidade_padrao: sens });
          existente = { id: r.id, excluido_em: null };
          onCriada();
        } catch (err) {
          existente = await achar(); // criada em paralelo por outro lote
          if (!existente || existente.excluido_em) throw err;
        }
      }
      cache.set(chave, existente.id);
      pai = existente.id;
    } catch (err) {
      cache.set(chave, err instanceof Error ? err : new Error("Falha ao criar a pasta."));
      throw err;
    }
  }
  return pai;
}

async function duplicado(ctx: CtxGed, sha256: string): Promise<{ visivel: { id: string; numero: string } | null } | null> {
  const v = await ctx.db.gedVersaoDocumento.findFirst({ where: { sha256, documento: { excluido_em: null } }, select: { documento_id: true } });
  if (!v) return null;
  // Só revela número/link de documento que o usuário pode ver (o fato de existir já basta para pular).
  const d = await ctx.db.gedDocumento.findFirst({ where: { AND: [{ id: v.documento_id }, await whereGedVisivel(ctx, "VER")] }, select: { id: true, numero: true } });
  return { visivel: d };
}

const TALLY_ZERO = (): Tally => ({ RECEBIDO: 0, IMPORTADO: 0, DUPLICADO: 0, IGNORADO: 0, ERRO: 0 });

async function contagem(db: GedDb, importacaoId: string): Promise<{ tally: Tally; bytes: Record<GedStatusItemImportacao, number> }> {
  const t = TALLY_ZERO();
  const b = TALLY_ZERO();
  const g = await db.gedImportacaoItem.groupBy({ by: ["status"], where: { importacao_id: importacaoId }, _count: { _all: true }, _sum: { tamanho: true } });
  for (const x of g) {
    t[x.status] = x._count._all;
    b[x.status] = Number(x._sum.tamanho ?? 0);
  }
  return { tally: t, bytes: b };
}

type Extra = { motivo?: string; documento_id?: string; pasta_id?: string | null; sha256?: string; tamanho?: number };
type Alvo = { ordem?: number; itemId?: string };

/** Grava o resultado de um item: atualiza a linha já existente (pasta) ou cria uma nova (ZIP), e os contadores do lote. */
async function registrar(est: Est, alvo: Alvo, caminho: string, status: GedStatusItemImportacao, extra: Extra = {}) {
  const campos = { status, motivo: extra.motivo?.slice(0, 500) ?? null, documento_id: extra.documento_id ?? null, pasta_id: extra.pasta_id ?? null, sha256: extra.sha256, tamanho: extra.tamanho };
  if (alvo.itemId) {
    await est.db.gedImportacaoItem.update({ where: { id: alvo.itemId }, data: { ...campos, storage_key: null } });
    est.tally.RECEBIDO = Math.max(0, est.tally.RECEBIDO - 1);
  } else {
    await est.db.gedImportacaoItem.create({
      data: { importacao_id: est.imp.id, ordem: alvo.ordem ?? est.proxOrdem++, caminho: caminho.slice(0, 1000), ...campos, sha256: extra.sha256 ?? null, tamanho: extra.tamanho ?? null } as Prisma.GedImportacaoItemUncheckedCreateInput,
    });
  }
  est.tally[status]++;
  await est.db.gedImportacao.update({
    where: { id: est.imp.id },
    data: { importados: est.tally.IMPORTADO, duplicados: est.tally.DUPLICADO, ignorados: est.tally.IGNORADO, com_erro: est.tally.ERRO, pastas_criadas: est.pastasCriadas },
  });
}

/** Importa UM PDF: pasta (criada se faltar) → validação → duplicado por sha256 → documento. Nunca lança (falha vira item ERRO). */
async function importarPdf(est: Est, alvo: Alvo, caminho: string, pasta: string[], nome: string, ler: () => Promise<Buffer>, shaConhecido?: string | null): Promise<void> {
  let pastaId: string | null = null;
  try {
    const segs = est.imp.unir_pastas ? unirPastasRepetidas(pasta) : pasta;
    pastaId = await resolverPasta(est.ctx, est.imp.pasta_destino_id, est.imp.sensibilidade, segs, est.cache, () => void est.pastasCriadas++);
    if (shaConhecido) {
      const dup = await duplicado(est.ctx, shaConhecido); // caminho rápido: o sha256 veio do envio, sem reler o arquivo
      if (dup) return await registrar(est, alvo, caminho, "DUPLICADO", { motivo: dup.visivel ? `Já existe na organização: ${dup.visivel.numero}.` : "Já existe na organização (documento sem acesso para você).", documento_id: dup.visivel?.id, pasta_id: pastaId, sha256: shaConhecido });
    }
    const dados = await ler();
    const v = validarUploadGed(dados, nome, "application/pdf");
    if (!v.ok) return await registrar(est, alvo, caminho, "ERRO", { motivo: v.erro, pasta_id: pastaId, tamanho: dados.length });
    const sha256 = sha256Hex(dados);
    const dup = sha256 === shaConhecido ? null : await duplicado(est.ctx, sha256);
    if (dup) return await registrar(est, alvo, caminho, "DUPLICADO", { motivo: dup.visivel ? `Já existe na organização: ${dup.visivel.numero}.` : "Já existe na organização (documento sem acesso para você).", documento_id: dup.visivel?.id, pasta_id: pastaId, sha256, tamanho: dados.length });
    const r = await criarDocumentoUpload(est.ctx, { titulo: tituloDoArquivo(nome), tipo_id: est.imp.tipo_id, pasta_id: pastaId, sensibilidade: est.imp.sensibilidade, arquivo: dados, nome_arquivo: nome, mime: "application/pdf" });
    await registrar(est, alvo, caminho, "IMPORTADO", { documento_id: r.id, pasta_id: pastaId, sha256, tamanho: dados.length });
  } catch (e) {
    await registrar(est, alvo, caminho, "ERRO", { motivo: motivoDoErro(e), pasta_id: pastaId });
  }
}

/**
 * Processa um ZIP em disco (o do lote ou um aninhado). `prefixo` = pastas onde o conteúdo cai (vazio na raiz; nome-base do ZIP
 * quando aninhado). Raiz: itens identificados por `ordem` do plano (retomada). Aninhado: por caminho (as ordens são alocadas na hora).
 */
async function processarZip(est: Est, arquivoZip: string, prefixo: string[], nivel: number): Promise<{ arquivos: number }> {
  const raiz = nivel === 0;
  const z = await ZipDisco.abrir(arquivoZip);
  try {
    const restante = Math.max(0, est.limites.maxArquivos - (raiz ? 0 : est.totalArquivos));
    const limitesLocal = { ...est.limites, maxArquivos: restante };
    const plano = planejarZip(await lerDiretorioZipDisco(z, est.limites), limitesLocal, { nivel });
    const prefixoTxt = prefixo.join("/");
    if (raiz) {
      est.totalArquivos = plano.itens.length;
      est.proxOrdem = Math.max(est.proxOrdem, plano.itens.length);
      await est.db.gedImportacao.update({ where: { id: est.imp.id }, data: { total_arquivos: plano.itens.length, ocultos: plano.ocultos } });
    } else {
      est.totalArquivos += plano.itens.length;
      await est.db.gedImportacao.update({ where: { id: est.imp.id }, data: { total_arquivos: est.totalArquivos, ocultos: { increment: plano.ocultos } } });
    }
    let prontosOrdem = new Set<number>();
    let prontosCaminho = new Set<string>();
    if (raiz) prontosOrdem = new Set((await est.db.gedImportacaoItem.findMany({ where: { importacao_id: est.imp.id }, select: { ordem: true } })).map((i) => i.ordem));
    else prontosCaminho = new Set((await est.db.gedImportacaoItem.findMany({ where: { importacao_id: est.imp.id, caminho: { startsWith: `${prefixoTxt}/` } }, select: { caminho: true } })).map((i) => i.caminho));

    for (const it of plano.itens) {
      const caminho = raiz ? it.caminho : `${prefixoTxt}/${it.caminho}`;
      if (raiz ? prontosOrdem.has(it.ordem) : prontosCaminho.has(caminho.slice(0, 1000))) continue;
      const alvo: Alvo = raiz ? { ordem: it.ordem } : {};
      if (it.previo) {
        await registrar(est, alvo, caminho, it.previo.status, { motivo: it.previo.motivo });
        continue;
      }
      const pasta = [...prefixo, ...it.pasta];
      if (it.aninhado) {
        await expandirZipAninhado(est, z, it.entrada, alvo, caminho, pasta, nomeBaseZip(it.nome), nivel + 1);
        continue;
      }
      await importarPdf(est, alvo, caminho, pasta, it.nome, () => extrairEntradaDisco(z, it.entrada, est.limites));
    }
    return { arquivos: plano.itens.length };
  } finally {
    await z.fechar();
  }
}

/** Extrai o ZIP aninhado para disco (em fluxo), processa como pasta `base` e registra o ZIP como item (ignorado, com nota). */
async function expandirZipAninhado(est: Est, pai: ZipDisco, entrada: Parameters<typeof extrairEntradaParaArquivo>[1], alvo: Alvo, caminho: string, pastaDoZip: string[], base: string, nivel: number) {
  const tmp = path.join(est.trabalho, `aninhado-${++est.contadorTmp}.zip`);
  try {
    await extrairEntradaParaArquivo(pai, entrada, tmp, est.limites.maxZipAninhadoBytes);
    const r = await processarZip(est, tmp, [...pastaDoZip, base], nivel);
    await registrar(est, alvo, caminho, "IGNORADO", { motivo: `ZIP aninhado expandido como a pasta "${base}" (${r.arquivos} arquivo(s)).`, tamanho: entrada.tamanho });
  } catch (e) {
    await registrar(est, alvo, caminho, "ERRO", { motivo: e instanceof ErroZip ? e.message : motivoDoErro(e) });
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/** Pasta enviada pelo navegador: a fila é o próprio banco (itens RECEBIDO por caminho) – memória constante em qualquer volume. */
async function processarPasta(est: Est): Promise<void> {
  const { db, imp, organizacaoId } = est;
  for (;;) {
    const lote = await db.gedImportacaoItem.findMany({
      where: { importacao_id: imp.id, status: "RECEBIDO" },
      orderBy: [{ caminho: "asc" }, { ordem: "asc" }],
      take: 50,
      select: { id: true, ordem: true, caminho: true, sha256: true, tamanho: true, storage_key: true },
    });
    if (lote.length === 0) break;
    for (const it of lote) {
      const alvo: Alvo = { itemId: it.id };
      const n = normalizarCaminho(it.caminho);
      try {
        if (!n.ok || !it.storage_key) {
          await registrar(est, alvo, it.caminho, "ERRO", { motivo: !n.ok ? n.erro : "Arquivo não encontrado no armazenamento temporário." });
          continue;
        }
        const nome = n.segmentos[n.segmentos.length - 1];
        const pasta = n.segmentos.slice(0, -1);
        const chave = it.storage_key;
        if (ehZip(nome)) {
          await processarZipDaPasta(est, alvo, it.caminho, pasta, nome, chave);
        } else {
          await importarPdf(est, alvo, it.caminho, pasta, nome, () => lerArquivoPasta(organizacaoId, chave), it.sha256);
        }
        await removerArquivoPasta(organizacaoId, chave).catch(() => {});
      } catch (e) {
        await registrar(est, alvo, it.caminho, "ERRO", { motivo: motivoDoErro(e) });
      }
    }
  }
}

async function processarZipDaPasta(est: Est, alvo: Alvo, caminho: string, pasta: string[], nome: string, chave: string) {
  const base = nomeBaseZip(nome);
  // Regra do ZIP duplicado (também verificada no servidor): existe, neste lote, algo dentro da pasta irmã com o nome-base do ZIP?
  const prefixo = `${[...pasta, base].join("/")}/`;
  const irma = await est.db.gedImportacaoItem.findFirst({ where: { importacao_id: est.imp.id, caminho: { startsWith: prefixo, mode: "insensitive" }, NOT: { id: alvo.itemId } }, select: { id: true } });
  if (irma) return await registrar(est, alvo, caminho, "IGNORADO", { motivo: MOTIVO_ZIP_DUPLICADO });
  const tmp = path.join(est.trabalho, `pasta-${++est.contadorTmp}.zip`);
  try {
    await mkdir(est.trabalho, { recursive: true });
    await writeFile(tmp, await lerArquivoPasta(est.organizacaoId, chave));
    const r = await processarZip(est, tmp, [...pasta, base], 1);
    await registrar(est, alvo, caminho, "IGNORADO", { motivo: `ZIP expandido como a pasta "${base}" (${r.arquivos} arquivo(s)).` });
  } catch (e) {
    await registrar(est, alvo, caminho, "ERRO", { motivo: e instanceof ErroZip ? e.message : motivoDoErro(e) });
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/** Apaga TUDO que o lote deixou no storage e no disco temporário (ZIP, partes, arquivos da pasta ainda não processados). */
export async function descartarArmazenamentoImportacao(db: GedDb, organizacaoId: string, imp: Pick<Lote, "id" | "storage_key" | "partes_total">): Promise<void> {
  if (imp.storage_key) await removerZipImportacao(organizacaoId, imp.storage_key).catch(() => {});
  if (imp.partes_total > 0) await removerPartesZip(organizacaoId, imp.id, imp.partes_total).catch(() => {});
  for (;;) {
    const itens = await db.gedImportacaoItem.findMany({ where: { importacao_id: imp.id, storage_key: { not: null } }, select: { id: true, storage_key: true }, take: 200 });
    if (itens.length === 0) break;
    for (const i of itens) await removerArquivoPasta(organizacaoId, i.storage_key!).catch(() => {});
    await db.gedImportacaoItem.updateMany({ where: { id: { in: itens.map((i) => i.id) } }, data: { storage_key: null } });
  }
  await limparTemporarios(organizacaoId, imp.id);
}

/** Processa um lote. Idempotente/retomável. Nunca lança por falha de item; falha do lote vira status FALHOU. */
export async function executarImportacao(organizacaoId: string, id: string, limites: LimitesZip = LIMITES_PADRAO): Promise<ResultadoExecucao> {
  const db = gedDb(organizacaoId);
  const imp = await db.gedImportacao.findUnique({ where: { id } });
  if (!imp || (imp.status !== "PENDENTE" && imp.status !== "PROCESSANDO")) return "IGNORADA";
  const corte = new Date(Date.now() - STALE_MS);
  const reivindicado = await db.gedImportacao.updateMany({
    where: { id, OR: [{ status: "PENDENTE" }, { status: "PROCESSANDO", updated_at: { lt: corte } }] },
    data: { status: "PROCESSANDO", iniciado_em: imp.iniciado_em ?? new Date() },
  });
  if (reivindicado.count === 0) return "IGNORADA";

  const falhar = async (msg: string): Promise<ResultadoExecucao> => {
    await db.gedImportacao.update({ where: { id }, data: { status: "FALHOU", erro: msg.slice(0, 500), concluido_em: new Date(), storage_key: null } });
    await descartarArmazenamentoImportacao(db, organizacaoId, imp).catch((e) => console.error("[ged-importar] descartar", e));
    await auditarGed({ usuario: { id: imp.criado_por_id } as CtxGed["usuario"], organizacao_id: organizacaoId }, { acao: "GED_IMPORTACAO_FALHOU", entidade: "ged_importacao", entidade_id: id, depois: { erro: msg } }).catch(() => {});
    return "FALHOU";
  };

  try {
    const ctx = await ctxGedPorUsuarioId(imp.criado_por_id);
    if (!ctx || ctx.organizacao_id !== organizacaoId) return await falhar("O usuário que enviou o lote não tem mais acesso ao módulo.");
    if (!podeImportarGed(ctx)) return await falhar("O usuário que enviou o lote não tem mais permissão para importar.");

    const { tally } = await contagem(db, id);
    const maxOrdem = await db.gedImportacaoItem.aggregate({ where: { importacao_id: id }, _max: { ordem: true } });
    const est: Est = {
      db, ctx, imp, organizacaoId, limites, tally,
      pastasCriadas: imp.pastas_criadas,
      cache: new Map(),
      proxOrdem: (maxOrdem._max.ordem ?? -1) + 1,
      totalArquivos: imp.total_arquivos,
      trabalho: pastaTrabalhoLocal(organizacaoId, id),
      contadorTmp: 0,
    };
    await mkdir(est.trabalho, { recursive: true });

    if (imp.origem === "PASTA") {
      await processarPasta(est);
    } else {
      let local: string;
      try {
        if (!imp.storage_key && imp.partes_total === 0) throw new Error("O arquivo ZIP do lote não está mais disponível.");
        const m = await montarZipLocal(organizacaoId, imp, () => void db.gedImportacao.update({ where: { id }, data: { erro: null } }).catch(() => {}));
        local = m.caminho;
        if (m.sha256 && imp.sha256_zip !== m.sha256) await db.gedImportacao.update({ where: { id }, data: { sha256_zip: m.sha256 } });
      } catch (e) {
        return await falhar(e instanceof Error && !(e instanceof ErroZip) ? e.message : "Não foi possível ler o ZIP do lote.");
      }
      try {
        await processarZip(est, local, [], 0);
      } catch (e) {
        if (e instanceof ErroZip) return await falhar(e.message);
        throw e;
      }
    }

    const { tally: final } = await contagem(db, id);
    const status = final.ERRO > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";
    await db.gedImportacao.update({
      where: { id },
      data: { status, concluido_em: new Date(), storage_key: null, importados: final.IMPORTADO, duplicados: final.DUPLICADO, ignorados: final.IGNORADO, com_erro: final.ERRO, pastas_criadas: est.pastasCriadas },
    });
    await descartarArmazenamentoImportacao(db, organizacaoId, imp).catch((e) => console.error("[ged-importar] limpar", e));
    await auditarGed(ctx, { acao: "GED_IMPORTACAO_CONCLUIDA", entidade: "ged_importacao", entidade_id: id, depois: { status, importados: final.IMPORTADO, duplicados: final.DUPLICADO, ignorados: final.IGNORADO, com_erro: final.ERRO, pastas_criadas: est.pastasCriadas } });
    return status;
  } catch (e) {
    console.error("[ged-importar] lote", id, e);
    return falhar("Falha inesperada ao processar o lote.");
  }
}

/** Lotes a processar em TODOS os clientes (PENDENTE, ou PROCESSANDO sem sinal de vida). Só ids; o job usa gedDb(organizacao_id). */
export async function importacoesPendentes(limite = 20): Promise<{ id: string; organizacao_id: string }[]> {
  const orgs = await gedDb(ID_NULO).organizacao.findMany({ where: { modulos: { has: "GED" } }, select: { id: true } });
  const corte = new Date(Date.now() - STALE_MS);
  const out: { id: string; organizacao_id: string }[] = [];
  for (const o of orgs) {
    if (out.length >= limite) break;
    const l = await gedDb(o.id).gedImportacao.findMany({
      where: { OR: [{ status: "PENDENTE" }, { status: "PROCESSANDO", updated_at: { lt: corte } }] },
      orderBy: { created_at: "asc" },
      take: limite - out.length,
      select: { id: true, organizacao_id: true },
    });
    out.push(...l);
  }
  return out;
}

/** Descarta lotes RECEBENDO abandonados (nunca finalizados) e seus arquivos. Chamado pela varredura do job. */
export async function limparImportacoesAbandonadas(): Promise<number> {
  const orgs = await gedDb(ID_NULO).organizacao.findMany({ where: { modulos: { has: "GED" } }, select: { id: true } });
  const corte = new Date(Date.now() - PRAZO_LOTE_ABANDONADO_MS);
  let n = 0;
  for (const o of orgs) {
    const db = gedDb(o.id);
    const velhos = await db.gedImportacao.findMany({ where: { status: "RECEBENDO", updated_at: { lt: corte } }, take: 20 });
    for (const imp of velhos) {
      await db.gedImportacao.update({ where: { id: imp.id }, data: { status: "FALHOU", erro: "Envio nunca finalizado (descartado após 3 dias).", concluido_em: new Date(), storage_key: null } });
      await descartarArmazenamentoImportacao(db, o.id, imp).catch(() => {});
      n++;
    }
  }
  return n;
}

// ───────────── Consulta ─────────────

export type LinhaImportacao = {
  id: string;
  created_at: Date;
  concluido_em: Date | null;
  nome_arquivo: string;
  tamanho_zip: number;
  status: string;
  erro: string | null;
  pasta_destino: string | null;
  sensibilidade: GedSensibilidade;
  total_arquivos: number;
  importados: number;
  duplicados: number;
  ignorados: number;
  com_erro: number;
  ocultos: number;
  pastas_criadas: number;
  criado_por: string;
  criado_por_id: string;
  origem: "ZIP" | "PASTA";
  unir_pastas: boolean;
  partes_total: number;
  total_esperado: number;
  /** Soma dos tamanhos (bytes) dos PDFs importados / de todos os itens do relatório (só em obterImportacao). */
  tamanho_importado?: number;
  tamanho_total?: number;
};

/** Admin vê todos os lotes do cliente; Gestor vê os que ele enviou (o relatório lista caminhos que podem estar fora do alcance dele). */
export const whereVisiveis = (ctx: CtxGed): Prisma.GedImportacaoWhereInput => (ctx.membro.papel === "GED_ADMIN" ? {} : { criado_por_id: ctx.usuario.id });

async function hidratar(ctx: CtxGed, rows: Prisma.GedImportacaoGetPayload<object>[]): Promise<LinhaImportacao[]> {
  const usuarios = await ctx.db.usuario.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.criado_por_id))] } }, select: { id: true, nome: true } });
  const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
  const pastaIds = [...new Set(rows.map((r) => r.pasta_destino_id).filter((x): x is string => !!x))];
  const pastas = pastaIds.length ? await ctx.db.gedPasta.findMany({ where: { id: { in: pastaIds } }, select: { id: true, caminho_nome: true } }) : [];
  const caminho = new Map(pastas.map((p) => [p.id, p.caminho_nome]));
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    concluido_em: r.concluido_em,
    nome_arquivo: r.nome_arquivo,
    tamanho_zip: r.tamanho_zip,
    status: r.status,
    erro: r.erro,
    pasta_destino: r.pasta_destino_id ? (caminho.get(r.pasta_destino_id) ?? "(pasta)") : null,
    sensibilidade: r.sensibilidade,
    total_arquivos: r.total_arquivos,
    importados: r.importados,
    duplicados: r.duplicados,
    ignorados: r.ignorados,
    com_erro: r.com_erro,
    ocultos: r.ocultos,
    pastas_criadas: r.pastas_criadas,
    criado_por: nome.get(r.criado_por_id) ?? "—",
    criado_por_id: r.criado_por_id,
    origem: r.origem,
    unir_pastas: r.unir_pastas,
    partes_total: r.partes_total,
    total_esperado: r.total_esperado,
  }));
}

export async function listarImportacoes(ctx: CtxGed, opc: { page?: number; size?: number } = {}): Promise<{ linhas: LinhaImportacao[]; total: number; page: number; size: number }> {
  if (!podeImportarGed(ctx)) throw proibido("Somente administradores e gestores acessam as importações.");
  const size = Math.min(100, Math.max(1, opc.size ?? 20));
  const page = Math.max(1, opc.page ?? 1);
  const where = whereVisiveis(ctx);
  const [rows, total] = await Promise.all([
    ctx.db.gedImportacao.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * size, take: size }),
    ctx.db.gedImportacao.count({ where }),
  ]);
  return { linhas: await hidratar(ctx, rows), total, page, size };
}

export async function obterImportacao(ctx: CtxGed, id: string): Promise<LinhaImportacao> {
  if (!podeImportarGed(ctx)) throw proibido("Somente administradores e gestores acessam as importações.");
  if (!ehUuid(id)) exigirEncontrado(null, "Importação não encontrada.");
  const r = exigirEncontrado(await ctx.db.gedImportacao.findFirst({ where: { AND: [{ id }, whereVisiveis(ctx)] } }), "Importação não encontrada.");
  const linha = (await hidratar(ctx, [r]))[0];
  const { bytes } = await contagem(ctx.db, id);
  return { ...linha, tamanho_importado: bytes.IMPORTADO, tamanho_total: Object.values(bytes).reduce((a, b) => a + b, 0) };
}

export type LinhaItemImportacao = { id: string; ordem: number; caminho: string; status: GedStatusItemImportacao; motivo: string | null; documento_id: string | null; pasta_id: string | null; tamanho: number | null };

export async function listarItensImportacao(ctx: CtxGed, id: string, opc: { status?: string | null; page?: number; size?: number } = {}): Promise<{ itens: LinhaItemImportacao[]; total: number; page: number; size: number }> {
  await obterImportacao(ctx, id); // 404 se for de outro cliente ou não for visível
  const size = Math.min(500, Math.max(1, opc.size ?? 50));
  const page = Math.max(1, opc.page ?? 1);
  const status = (["RECEBIDO", "IMPORTADO", "DUPLICADO", "IGNORADO", "ERRO"] as const).find((s) => s === opc.status);
  const where: Prisma.GedImportacaoItemWhereInput = { importacao_id: id, ...(status ? { status } : {}) };
  const [itens, total] = await Promise.all([
    ctx.db.gedImportacaoItem.findMany({ where, orderBy: { ordem: "asc" }, skip: (page - 1) * size, take: size, select: { id: true, ordem: true, caminho: true, status: true, motivo: true, documento_id: true, pasta_id: true, tamanho: true } }),
    ctx.db.gedImportacaoItem.count({ where }),
  ]);
  return { itens, total, page, size };
}
