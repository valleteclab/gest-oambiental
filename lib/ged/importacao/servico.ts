// Importação em lote de ZIP (fase 2 do GED). A estrutura de pastas do ZIP vira a árvore de pastas do GED.
//
//   criarImportacao ........ (API/tela) valida o ZIP (limites), grava em ged/{org}/importacao/{id}.zip e registra o lote PENDENTE
//   executarImportacao ..... (job ged-importar, ou inline sem worker) processa item a item; retomável (itens já gravados são pulados)
//   listar/obter/itens ..... consulta do lote e do relatório
//
// Regras: papel com `importar` (Admin/Gestor); pastas criadas via criarPasta() (EDITAR no pai); documentos via
// criarDocumentoUpload() (origem UPLOAD, EDITAR na pasta, ACL do criador, número, versão 1, auditoria, texto);
// a visibilidade vem da ACL herdada da pasta de destino. Duplicado = mesmo sha256 já existente na organização (documento
// não excluído) → pulado e relatado. Cada arquivo é independente: falha de um vira item ERRO, o lote continua.
// Tudo via gedDb(organizacao_id); nenhum SQL cru.
import { randomUUID } from "node:crypto";
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
import { lerZipImportacao, removerZipImportacao, salvarZipImportacao, chaveZipImportacao } from "./arquivo";
import { LIMITES_PADRAO, type LimitesZip } from "./limites";
import { tituloDoArquivo } from "./nomes";
import { ErroZip, extrairEntrada, lerDiretorioZip, planejarZip } from "./zip";

const ID_NULO = "00000000-0000-0000-0000-000000000000";
/** Lotes ativos (pendentes/processando) por cliente ao mesmo tempo. */
export const MAX_LOTES_ATIVOS = 3;
/** Um lote PROCESSANDO sem sinal de vida por este tempo é retomado (worker caiu). */
export const STALE_MS = 10 * 60 * 1000;

const ehUuid = (v: unknown): v is string => zUuid.safeParse(v).success;

export type EntradaImportacao = {
  nome_arquivo: string;
  arquivo: Buffer;
  pasta_id?: string | null;
  tipo_id?: string | null;
  sensibilidade?: string | null;
};

// ───────────── Criar ─────────────

export async function criarImportacao(ctx: CtxGed, e: EntradaImportacao, limites: LimitesZip = LIMITES_PADRAO): Promise<{ id: string; status: "PENDENTE" }> {
  if (!podeImportarGed(ctx)) throw proibido("Somente administradores e gestores podem importar ZIP.");
  const nome = (e.nome_arquivo ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  if (!/\.zip$/i.test(nome)) throw invalido("Envie um arquivo ZIP (.zip).");
  if (!e.arquivo || e.arquivo.length === 0) throw invalido("Arquivo vazio.");
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
  const ativos = await ctx.db.gedImportacao.count({ where: { status: { in: ["PENDENTE", "PROCESSANDO"] } } });
  if (ativos >= MAX_LOTES_ATIVOS) throw new ErroApi(429, "MUITAS_IMPORTACOES", `Já há ${ativos} importações em andamento. Aguarde a conclusão para enviar outra.`);

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
        } as Prisma.GedImportacaoUncheckedCreateInput,
      });
      await auditarGed(ctx, { acao: "GED_IMPORTACAO_CRIADA", entidade: "ged_importacao", entidade_id: id, depois: { nome_arquivo: nome, tamanho: e.arquivo.length, pasta_destino_id: pastaId, tipo_id: tipoId, sensibilidade } }, tx);
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

async function contagem(db: GedDb, importacaoId: string): Promise<Tally> {
  const t: Tally = { IMPORTADO: 0, DUPLICADO: 0, IGNORADO: 0, ERRO: 0 };
  const g = await db.gedImportacaoItem.groupBy({ by: ["status"], where: { importacao_id: importacaoId }, _count: { _all: true } });
  for (const x of g) t[x.status] = x._count._all;
  return t;
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
    if (imp.storage_key) await removerZipImportacao(organizacaoId, imp.storage_key).catch(() => {});
    await auditarGed({ usuario: { id: imp.criado_por_id } as CtxGed["usuario"], organizacao_id: organizacaoId }, { acao: "GED_IMPORTACAO_FALHOU", entidade: "ged_importacao", entidade_id: id, depois: { erro: msg } }).catch(() => {});
    return "FALHOU";
  };

  try {
    const ctx = await ctxGedPorUsuarioId(imp.criado_por_id);
    if (!ctx || ctx.organizacao_id !== organizacaoId) return await falhar("O usuário que enviou o lote não tem mais acesso ao módulo.");
    if (!podeImportarGed(ctx)) return await falhar("O usuário que enviou o lote não tem mais permissão para importar.");
    if (!imp.storage_key) return await falhar("O arquivo ZIP do lote não está mais disponível.");

    let zip: Buffer;
    let plano;
    try {
      zip = await lerZipImportacao(organizacaoId, imp.storage_key);
      plano = planejarZip(lerDiretorioZip(zip, limites), limites);
    } catch (e) {
      return await falhar(e instanceof ErroZip ? e.message : "Não foi possível ler o ZIP do lote.");
    }

    const prontos = new Set((await db.gedImportacaoItem.findMany({ where: { importacao_id: id }, select: { ordem: true } })).map((i) => i.ordem));
    const tally = await contagem(db, id);
    let pastasCriadas = imp.pastas_criadas;
    await db.gedImportacao.update({ where: { id }, data: { total_arquivos: plano.itens.length, ocultos: plano.ocultos } });
    const cache = new Map<string, string | Error>();

    const registrar = async (ordem: number, caminho: string, status: GedStatusItemImportacao, extra: { motivo?: string; documento_id?: string; pasta_id?: string | null; sha256?: string; tamanho?: number } = {}) => {
      await db.gedImportacaoItem.create({
        data: { importacao_id: id, ordem, caminho, status, motivo: extra.motivo?.slice(0, 500) ?? null, documento_id: extra.documento_id ?? null, pasta_id: extra.pasta_id ?? null, sha256: extra.sha256 ?? null, tamanho: extra.tamanho ?? null } as Prisma.GedImportacaoItemUncheckedCreateInput,
      });
      tally[status]++;
      await db.gedImportacao.update({ where: { id }, data: { importados: tally.IMPORTADO, duplicados: tally.DUPLICADO, ignorados: tally.IGNORADO, com_erro: tally.ERRO, pastas_criadas: pastasCriadas } });
    };

    for (const it of plano.itens) {
      if (prontos.has(it.ordem)) continue;
      if (it.previo) {
        await registrar(it.ordem, it.caminho, it.previo.status, { motivo: it.previo.motivo });
        continue;
      }
      let pastaId: string | null = null;
      try {
        pastaId = await resolverPasta(ctx, imp.pasta_destino_id, imp.sensibilidade, it.pasta, cache, () => void pastasCriadas++);
        const dados = extrairEntrada(zip, it.entrada, limites);
        const v = validarUploadGed(dados, it.nome, "application/pdf");
        if (!v.ok) {
          await registrar(it.ordem, it.caminho, "ERRO", { motivo: v.erro, pasta_id: pastaId, tamanho: dados.length });
          continue;
        }
        const sha256 = sha256Hex(dados);
        const dup = await duplicado(ctx, sha256);
        if (dup) {
          await registrar(it.ordem, it.caminho, "DUPLICADO", { motivo: dup.visivel ? `Já existe na organização: ${dup.visivel.numero}.` : "Já existe na organização (documento sem acesso para você).", documento_id: dup.visivel?.id, pasta_id: pastaId, sha256, tamanho: dados.length });
          continue;
        }
        const r = await criarDocumentoUpload(ctx, { titulo: tituloDoArquivo(it.nome), tipo_id: imp.tipo_id, pasta_id: pastaId, sensibilidade: imp.sensibilidade, arquivo: dados, nome_arquivo: it.nome, mime: "application/pdf" });
        await registrar(it.ordem, it.caminho, "IMPORTADO", { documento_id: r.id, pasta_id: pastaId, sha256, tamanho: dados.length });
      } catch (e) {
        await registrar(it.ordem, it.caminho, "ERRO", { motivo: motivoDoErro(e), pasta_id: pastaId });
      }
    }

    const final = await contagem(db, id);
    const status = final.ERRO > 0 ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";
    await db.gedImportacao.update({
      where: { id },
      data: { status, concluido_em: new Date(), storage_key: null, importados: final.IMPORTADO, duplicados: final.DUPLICADO, ignorados: final.IGNORADO, com_erro: final.ERRO, pastas_criadas: pastasCriadas },
    });
    await removerZipImportacao(organizacaoId, imp.storage_key).catch((e) => console.error("[ged-importar] remover zip", e));
    await auditarGed(ctx, { acao: "GED_IMPORTACAO_CONCLUIDA", entidade: "ged_importacao", entidade_id: id, depois: { status, importados: final.IMPORTADO, duplicados: final.DUPLICADO, ignorados: final.IGNORADO, com_erro: final.ERRO, pastas_criadas: pastasCriadas } });
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
};

/** Admin vê todos os lotes do cliente; Gestor vê os que ele enviou (o relatório lista caminhos que podem estar fora do alcance dele). */
const whereVisiveis = (ctx: CtxGed): Prisma.GedImportacaoWhereInput => (ctx.membro.papel === "GED_ADMIN" ? {} : { criado_por_id: ctx.usuario.id });

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
  return (await hidratar(ctx, [r]))[0];
}

export type LinhaItemImportacao = { id: string; ordem: number; caminho: string; status: GedStatusItemImportacao; motivo: string | null; documento_id: string | null; pasta_id: string | null; tamanho: number | null };

export async function listarItensImportacao(ctx: CtxGed, id: string, opc: { status?: string | null; page?: number; size?: number } = {}): Promise<{ itens: LinhaItemImportacao[]; total: number; page: number; size: number }> {
  await obterImportacao(ctx, id); // 404 se for de outro cliente ou não for visível
  const size = Math.min(500, Math.max(1, opc.size ?? 50));
  const page = Math.max(1, opc.page ?? 1);
  const status = (["IMPORTADO", "DUPLICADO", "IGNORADO", "ERRO"] as const).find((s) => s === opc.status);
  const where: Prisma.GedImportacaoItemWhereInput = { importacao_id: id, ...(status ? { status } : {}) };
  const [itens, total] = await Promise.all([
    ctx.db.gedImportacaoItem.findMany({ where, orderBy: { ordem: "asc" }, skip: (page - 1) * size, take: size, select: { id: true, ordem: true, caminho: true, status: true, motivo: true, documento_id: true, pasta_id: true, tamanho: true } }),
    ctx.db.gedImportacaoItem.count({ where }),
  ]);
  return { itens, total, page, size };
}
