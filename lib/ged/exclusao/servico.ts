// Exclusão controlada de documento, pasta (subárvore) e conteúdo de lote de importação – docs/ged.md §17.
//
//   planejarExclusao ........ (plano.ts) pré-visualização: contagens, tamanho e impedimentos. Só leitura.
//   iniciarExclusao ......... capacidade `excluir` (Admin/Gestor) + permissão no recurso + confirmação digitada + plano sem impedimento
//                             (tudo-ou-nada) ou "apenas os que podem"; grava GedExclusao e executa na hora (pequeno) ou deixa para o job.
//   executarExclusao ........ retomável: reavalia o que ainda existe, apaga documentos em blocos (uma transação por bloco), depois as
//                             pastas vazias (filhas antes das mães) e, por último, os arquivos do storage (órfãos são tolerados).
//
// NENHUMA trava de imutabilidade é desligada: tudo que tem valor jurídico (trâmite, comentário, solicitação de assinatura, versão
// selada, protocolo) é impedimento e o banco também recusa (FK RESTRICT + triggers). Histórico: cada documento e pasta excluídos
// geram uma linha no log_auditoria (imutável) com número, título, caminho, sha256, quem e quando; os logs de acesso (ged_acesso_log)
// NÃO são apagados (não têm FK para o documento; a tela de logs mostra o número a partir da auditoria). Tudo via gedDb(organizacao_id).
import type { GedExclusao, GedTipoExclusao, Prisma } from "@prisma/client";
import { fmtDataHora } from "@/lib/format";
import { ErroApi, invalido, proibido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import { exigirEncontrado, gedDb, organizacoesGedAtivas, type GedTx } from "../db";
import { ctxGedPorUsuarioId, type CtxGed } from "../escopo";
import { podeExcluirGed } from "../papeis";
import { removerArquivoGed } from "../storage";
import { zUuid } from "../tipos";
import { analisarDocumentos, pastasRemoviveisAgora, planejarExclusao, type AlvoExclusao, type PlanoInterno } from "./plano";
import {
  confirmacaoValida, decidirPlano, emBlocos, ordenarPastasFilhasPrimeiro, propagarDerivados, STALE_EXCLUSAO_MS, TAMANHO_BLOCO_DOCUMENTOS, TAMANHO_BLOCO_PASTAS, type PlanoExclusaoPublico,
} from "./regras";

export type ExclusaoView = {
  id: string;
  tipo: GedTipoExclusao;
  alvo_id: string;
  alvo_rotulo: string;
  apenas_possiveis: boolean;
  status: GedExclusao["status"];
  erro: string | null;
  created_at: Date;
  iniciado_em: Date | null;
  concluido_em: Date | null;
  total_documentos: number;
  documentos_excluidos: number;
  total_pastas: number;
  pastas_excluidas: number;
  versoes_excluidas: number;
  bytes_excluidos: number;
  bloqueados: number;
  /** 0–100, só para a barra de progresso. */
  percentual: number;
};

export function paraView(e: GedExclusao): ExclusaoView {
  const total = e.total_documentos + e.total_pastas;
  const feito = e.documentos_excluidos + e.pastas_excluidas;
  return {
    id: e.id, tipo: e.tipo, alvo_id: e.alvo_id, alvo_rotulo: e.alvo_rotulo, apenas_possiveis: e.apenas_possiveis, status: e.status, erro: e.erro, created_at: e.created_at,
    iniciado_em: e.iniciado_em, concluido_em: e.concluido_em, total_documentos: e.total_documentos, documentos_excluidos: e.documentos_excluidos, total_pastas: e.total_pastas,
    pastas_excluidas: e.pastas_excluidas, versoes_excluidas: e.versoes_excluidas, bytes_excluidos: Number(e.bytes_excluidos), bloqueados: e.bloqueados,
    percentual: e.status === "CONCLUIDA" ? 100 : total === 0 ? 0 : Math.min(99, Math.floor((feito / total) * 100)),
  };
}

export function exigirPodeExcluir(ctx: CtxGed): void {
  if (!podeExcluirGed(ctx)) throw proibido("Somente administradores e gestores podem excluir documentos, pastas e importações.");
}

const RE_FINAL = ["CONCLUIDA", "FALHOU"];
export const exclusaoFinalizada = (status: string) => RE_FINAL.includes(status);

// ───────────── Início ─────────────

export type EntradaExclusao = { confirmacao: unknown; apenas_possiveis?: boolean };
export type ResultadoInicio = { exclusao: ExclusaoView; plano: PlanoExclusaoPublico };

export async function iniciarExclusao(ctx: CtxGed, alvo: AlvoExclusao, e: EntradaExclusao): Promise<ResultadoInicio> {
  exigirPodeExcluir(ctx);
  if (!zUuid.safeParse(alvo.id).success) exigirEncontrado(null, "Registro não encontrado.");
  const apenas = e.apenas_possiveis === true;
  const plano = await planejarExclusao(ctx, alvo);
  if (plano.em_andamento) throw new ErroApi(409, "IMPORTACAO_EM_ANDAMENTO", plano.publico.mensagem_bloqueio ?? "Importação em andamento.", plano.publico);
  if (!confirmacaoValida(plano.publico.confirmacao_esperada, e.confirmacao)) {
    throw invalido(
      alvo.tipo === "PASTA" ? `Confirmação incorreta: digite exatamente o nome da pasta (${plano.publico.confirmacao_esperada}).` : `Confirmação incorreta: digite ${plano.publico.confirmacao_esperada}.`,
    );
  }
  const decisao = decidirPlano({ excluiveis: plano.excluiveis.length, bloqueados: plano.publico.bloqueados_total, pastas_removiveis: plano.pastas_removiveis.length }, apenas);
  if (!decisao.ok) {
    if (decisao.motivo === "BLOQUEADO") throw new ErroApi(409, "EXCLUSAO_BLOQUEADA", plano.publico.mensagem_bloqueio ?? "Há documentos que não podem ser excluídos.", plano.publico);
    throw new ErroApi(409, "NADA_A_EXCLUIR", "Não há nada a excluir: os documentos restantes têm impedimento ou não existem mais.", plano.publico);
  }
  const ativa = await ctx.db.gedExclusao.count({ where: { status: { in: ["PENDENTE", "PROCESSANDO"] } } });
  if (ativa > 0) throw new ErroApi(409, "EXCLUSAO_EM_ANDAMENTO", "Já há uma exclusão em andamento neste cliente. Aguarde a conclusão para iniciar outra.");

  const criada = await ctx.db.$transaction(async (tx) => {
    const x = await tx.gedExclusao.create({
      data: {
        criado_por_id: ctx.usuario.id, tipo: alvo.tipo, alvo_id: alvo.id, alvo_rotulo: plano.publico.alvo.rotulo.slice(0, 500), apenas_possiveis: apenas,
        total_documentos: plano.excluiveis.length, total_pastas: plano.pastas_removiveis.length, bloqueados: apenas ? plano.publico.bloqueados_total : 0,
      } as Prisma.GedExclusaoUncheckedCreateInput,
    });
    await auditarGed(
      ctx,
      {
        acao: "GED_EXCLUSAO_INICIADA", entidade: "ged_exclusao", entidade_id: x.id,
        depois: {
          tipo: alvo.tipo, alvo_id: alvo.id, alvo: plano.publico.alvo.rotulo, apenas_possiveis: apenas, documentos: plano.excluiveis.length, pastas: plano.pastas_removiveis.length,
          versoes: plano.publico.versoes, bytes: plano.publico.bytes, bloqueados_mantidos: apenas ? plano.publico.bloqueados_total : 0,
        },
      },
      tx,
    );
    return x;
  });

  if (plano.publico.sincrono) {
    await executarExclusao(ctx.organizacao_id, criada.id);
    const fim = exigirEncontrado(await ctx.db.gedExclusao.findUnique({ where: { id: criada.id } }));
    return { exclusao: paraView(fim), plano: plano.publico };
  }
  void iniciarExclusaoAposCriar(ctx.organizacao_id, criada.id);
  return { exclusao: paraView(criada), plano: plano.publico };
}

/** Sem worker no ar, processa em segundo plano no próprio processo web (mesmo critério da importação). */
export async function iniciarExclusaoAposCriar(organizacaoId: string, id: string): Promise<"worker" | "inline"> {
  let viaWorker = false;
  try {
    const { workerNoAr } = await import("@/lib/agente/ingestao");
    viaWorker = process.env.GED_EXCLUSAO_INLINE !== "true" && (await workerNoAr());
  } catch {
    viaWorker = false;
  }
  if (!viaWorker) void executarExclusao(organizacaoId, id).catch((e) => console.error("[ged-excluir] inline", e));
  return viaWorker ? "worker" : "inline";
}

// ───────────── Blocos ─────────────

type ResultadoBloco = { excluidos: number; versoes: number; bytes: number; bloqueados: number; chaves: string[] };
type DadosExclusao = Pick<GedExclusao, "id" | "tipo" | "alvo_rotulo">;

/**
 * UMA transação: reavalia os impedimentos (a situação pode ter mudado desde o plano), audita cada documento, apaga os dependentes e
 * o documento. Quem ficou impedido nesse intervalo é pulado (contado em `bloqueados`). Devolve as chaves de storage para apagar DEPOIS.
 */
async function excluirBlocoDocumentos(ctx: CtxGed, ids: string[], ex: DadosExclusao): Promise<ResultadoBloco> {
  return ctx.db.$transaction(
    async (tx) => {
      const ctxTx = { ...ctx, db: tx } as unknown as CtxGed;
      const analisados = await analisarDocumentos(ctxTx, ids);
      const bloqueios = new Map(analisados.map((d) => [d.id, [...d.motivos]]));
      const derivadas = new Map<string, string[]>();
      for (const d of await tx.gedDocumento.findMany({ where: { documento_original_id: { in: ids } }, select: { id: true, documento_original_id: true } })) {
        if (d.documento_original_id) derivadas.set(d.documento_original_id, [...(derivadas.get(d.documento_original_id) ?? []), d.id]);
      }
      propagarDerivados(analisados.map((d) => d.id), derivadas, bloqueios);
      const ok = analisados.filter((d) => (bloqueios.get(d.id)?.length ?? 0) === 0);
      const pulados = analisados.length - ok.length; // documentos que ainda existem mas viraram impedimento (ids já inexistentes não contam)
      if (ok.length === 0) return { excluidos: 0, versoes: 0, bytes: 0, bloqueados: pulados, chaves: [] };
      const okIds = ok.map((d) => d.id);

      const [docs, versoes] = await Promise.all([
        tx.gedDocumento.findMany({
          where: { id: { in: okIds } },
          select: { id: true, numero: true, titulo: true, status: true, sensibilidade: true, criado_por_id: true, created_at: true, versao_atual_id: true, documento_original_id: true, pasta: { select: { id: true, caminho_nome: true } } },
        }),
        tx.gedVersaoDocumento.findMany({ where: { documento_id: { in: okIds } }, select: { id: true, documento_id: true, n: true, sha256: true, tamanho: true, storage_key: true } }),
      ]);
      const versoesDe = new Map<string, typeof versoes>();
      for (const v of versoes) versoesDe.set(v.documento_id, [...(versoesDe.get(v.documento_id) ?? []), v]);

      for (const d of docs) {
        const vs = versoesDe.get(d.id) ?? [];
        const atual = vs.find((v) => v.id === d.versao_atual_id) ?? vs.sort((a, b) => b.n - a.n)[0];
        await auditarGed(
          ctx,
          {
            acao: "GED_DOCUMENTO_EXCLUIDO", entidade: "ged_documento", entidade_id: d.id,
            antes: {
              numero: d.numero, titulo: d.titulo, pasta_id: d.pasta?.id ?? null, caminho: d.pasta?.caminho_nome ?? null, sha256: atual?.sha256 ?? null, versoes: vs.length,
              bytes: vs.reduce((a, v) => a + v.tamanho, 0), status: d.status, sensibilidade: d.sensibilidade, criado_por_id: d.criado_por_id, criado_em: d.created_at.toISOString(),
            },
            depois: { excluido: true, via: ex.tipo, origem: ex.alvo_rotulo, exclusao_id: ex.id },
          },
          tx,
        );
      }

      const versaoIds = versoes.map((v) => v.id);
      // Dependentes que apontam para o documento SEM FK (e têm trigger de tenant) são atualizados ANTES de apagá-lo.
      await tx.gedComunicacao.updateMany({ where: { documento_id: { in: okIds }, status: "PENDENTE" }, data: { status: "IGNORADA", erro: "Documento excluído." } });
      await tx.gedImportacaoItem.updateMany({
        where: { documento_id: { in: okIds }, status: "IMPORTADO" },
        data: { status: "REMOVIDO", documento_id: null, motivo: `Documento excluído em ${fmtDataHora(new Date())} por ${ctx.usuario.nome}.`.slice(0, 500) },
      });
      await tx.gedImportacaoItem.updateMany({ where: { documento_id: { in: okIds } }, data: { documento_id: null } });

      await revogarLinksDoRecurso(tx, { documentoIds: okIds }, ex.alvo_rotulo);
      await tx.gedConteudoTexto.deleteMany({ where: { documento_id: { in: okIds } } });
      if (versaoIds.length) await tx.gedDeteccaoDadoPessoal.deleteMany({ where: { versao_id: { in: versaoIds } } });
      await tx.gedVersaoDocumento.deleteMany({ where: { documento_id: { in: okIds } } });
      await tx.gedDocumentoMarcador.deleteMany({ where: { documento_id: { in: okIds } } });
      await tx.gedAcl.deleteMany({ where: { documento_id: { in: okIds } } });
      // derivadas (anonimizadas) antes dos originais
      const derivs = docs.filter((d) => d.documento_original_id).map((d) => d.id);
      if (derivs.length) await tx.gedDocumento.deleteMany({ where: { id: { in: derivs } } });
      const restantes = okIds.filter((i) => !derivs.includes(i));
      if (restantes.length) await tx.gedDocumento.deleteMany({ where: { id: { in: restantes } } });

      return { excluidos: okIds.length, versoes: versoes.length, bytes: versoes.reduce((a, v) => a + v.tamanho, 0), bloqueados: pulados, chaves: versoes.map((v) => v.storage_key) };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/** Excluir o recurso invalida o link público dele (compartilhamento externo, docs/ged.md §18): revoga e encerra as sessões. */
async function revogarLinksDoRecurso(tx: GedTx, alvo: { documentoIds?: string[]; pastaIds?: string[] }, origem: string): Promise<void> {
  const ou = [...(alvo.documentoIds?.length ? [{ documento_id: { in: alvo.documentoIds } }] : []), ...(alvo.pastaIds?.length ? [{ pasta_id: { in: alvo.pastaIds } }] : [])];
  if (!ou.length) return;
  const links = await tx.gedCompartilhamento.findMany({ where: { status: "ATIVO", OR: ou }, select: { id: true } });
  if (!links.length) return;
  const agora = new Date();
  const ids = links.map((l) => l.id);
  await tx.gedCompartilhamento.updateMany({ where: { id: { in: ids } }, data: { status: "REVOGADO", revogado_em: agora, revogado_motivo: "Recurso excluído." } });
  await tx.gedCompartilhamentoSessao.updateMany({ where: { compartilhamento_id: { in: ids }, encerrada_em: null }, data: { encerrada_em: agora } });
  await tx.gedCompartilhamentoEvento.createMany({ data: ids.map((id) => ({ compartilhamento_id: id, tipo: "RECURSO_EXCLUIDO", detalhe: `exclusão: ${origem}`.slice(0, 300) })) as never });
}

/** Remove os arquivos DEPOIS do commit do banco. Falha (ou chave estranha) deixa só um arquivo órfão – nunca um registro sem arquivo. */
async function removerArquivos(organizacaoId: string, chaves: string[]): Promise<void> {
  for (const k of chaves) await removerArquivoGed(organizacaoId, k).catch(() => {});
}

async function excluirBlocoPastas(ctx: CtxGed, ids: string[], ex: DadosExclusao): Promise<number> {
  return ctx.db.$transaction(
    async (tx) => {
      let n = 0;
      for (const id of ids) {
        const p = await tx.gedPasta.findUnique({ where: { id }, select: { nome: true, caminho_nome: true, parent_id: true, sensibilidade_padrao: true } });
        if (!p) continue;
        const [docs, filhas] = await Promise.all([tx.gedDocumento.count({ where: { pasta_id: id } }), tx.gedPasta.count({ where: { parent_id: id } })]);
        if (docs > 0 || filhas > 0) continue; // nunca esvazia por baixo: o FK faria o conteúdo "subir" para a raiz
        await revogarLinksDoRecurso(tx, { pastaIds: [id] }, ex.alvo_rotulo);
        await tx.gedAcl.deleteMany({ where: { pasta_id: id } });
        await tx.gedImportacaoItem.updateMany({ where: { pasta_id: id }, data: { pasta_id: null } });
        await tx.gedImportacao.updateMany({ where: { pasta_destino_id: id }, data: { pasta_destino_id: null } });
        await auditarGed(ctx, { acao: "GED_PASTA_EXCLUIDA", entidade: "ged_pasta", entidade_id: id, antes: { nome: p.nome, caminho: p.caminho_nome, parent_id: p.parent_id, sensibilidade_padrao: p.sensibilidade_padrao }, depois: { excluida: true, via: ex.tipo, origem: ex.alvo_rotulo, exclusao_id: ex.id } }, tx);
        await tx.gedPasta.delete({ where: { id } });
        n++;
      }
      return n;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

// ───────────── Execução (job ou inline) ─────────────

export type ResultadoExecucaoExclusao = "CONCLUIDA" | "FALHOU" | "IGNORADA";

export async function executarExclusao(organizacaoId: string, id: string): Promise<ResultadoExecucaoExclusao> {
  const db = gedDb(organizacaoId);
  const ex = await db.gedExclusao.findUnique({ where: { id } });
  if (!ex || (ex.status !== "PENDENTE" && ex.status !== "PROCESSANDO")) return "IGNORADA";
  const corte = new Date(Date.now() - STALE_EXCLUSAO_MS);
  const reivindicada = await db.gedExclusao.updateMany({ where: { id, OR: [{ status: "PENDENTE" }, { status: "PROCESSANDO", updated_at: { lt: corte } }] }, data: { status: "PROCESSANDO", iniciado_em: ex.iniciado_em ?? new Date(), erro: null } });
  if (reivindicada.count === 0) return "IGNORADA";

  const falhar = async (msg: string): Promise<ResultadoExecucaoExclusao> => {
    await db.gedExclusao.update({ where: { id }, data: { status: "FALHOU", erro: msg.slice(0, 500), concluido_em: new Date() } });
    await auditarGed({ usuario: { id: ex.criado_por_id } as CtxGed["usuario"], organizacao_id: organizacaoId }, { acao: "GED_EXCLUSAO_FALHOU", entidade: "ged_exclusao", entidade_id: id, depois: { erro: msg } }).catch(() => {});
    return "FALHOU";
  };

  try {
    const ctx = await ctxGedPorUsuarioId(ex.criado_por_id);
    if (!ctx || ctx.organizacao_id !== organizacaoId) return await falhar("O usuário que iniciou a exclusão não tem mais acesso ao módulo.");
    if (!podeExcluirGed(ctx)) return await falhar("O usuário que iniciou a exclusão não tem mais permissão para excluir.");

    let plano: PlanoInterno | null = null;
    try {
      plano = await planejarExclusao(ctx, { tipo: ex.tipo, id: ex.alvo_id });
    } catch (e) {
      // Alvo já inexistente (retomada depois de a pasta raiz ter sido removida): resta apenas fechar a exclusão.
      if (!(e instanceof ErroApi && e.status === 404)) throw e;
    }
    if (plano && !ex.apenas_possiveis && plano.publico.bloqueados_total > 0) {
      return await falhar("Surgiram impedimentos depois da confirmação (por exemplo, uma assinatura ou um trâmite). Nada mais foi excluído; revise e inicie de novo.");
    }

    const dados: DadosExclusao = { id: ex.id, tipo: ex.tipo, alvo_rotulo: ex.alvo_rotulo };
    if (plano) {
      for (const bloco of emBlocos(plano.excluiveis, TAMANHO_BLOCO_DOCUMENTOS)) {
        let r: ResultadoBloco;
        try {
          r = await excluirBlocoDocumentos(ctx, bloco, dados);
        } catch (e) {
          console.error("[ged-excluir] bloco", id, e);
          // Cai para um por vez: o documento que falhar (ex.: virou impedimento no meio) não derruba os demais.
          r = { excluidos: 0, versoes: 0, bytes: 0, bloqueados: 0, chaves: [] };
          for (const um of bloco) {
            try {
              const x = await excluirBlocoDocumentos(ctx, [um], dados);
              r.excluidos += x.excluidos; r.versoes += x.versoes; r.bytes += x.bytes; r.bloqueados += x.bloqueados; r.chaves.push(...x.chaves);
            } catch {
              r.bloqueados++;
            }
          }
        }
        await removerArquivos(organizacaoId, r.chaves);
        await db.gedExclusao.update({ where: { id }, data: { documentos_excluidos: { increment: r.excluidos }, versoes_excluidas: { increment: r.versoes }, bytes_excluidos: { increment: BigInt(r.bytes) }, ...(r.bloqueados ? { bloqueados: { increment: r.bloqueados } } : {}) } });
      }
      // pastas vazias (as que ainda estão ocupadas ficam; no tudo-ou-nada isso só ocorre se algo mudou no caminho)
      const aRemover = ordenarPastasFilhasPrimeiro(await pastasRemoviveisAgora(ctx, plano.pastas_candidatas));
      for (const bloco of emBlocos(aRemover.map((p) => p.id), TAMANHO_BLOCO_PASTAS)) {
        const n = await excluirBlocoPastas(ctx, bloco, dados);
        await db.gedExclusao.update({ where: { id }, data: { pastas_excluidas: { increment: n } } });
      }
    }
    if (ex.tipo === "IMPORTACAO") {
      await db.gedImportacao.update({ where: { id: ex.alvo_id }, data: { conteudo_excluido_em: new Date() } }).catch(() => {});
    }
    const fim = exigirEncontrado(await db.gedExclusao.update({ where: { id }, data: { status: "CONCLUIDA", concluido_em: new Date() } }));
    await auditarGed(ctx, {
      acao: "GED_EXCLUSAO_CONCLUIDA", entidade: "ged_exclusao", entidade_id: id,
      depois: {
        tipo: fim.tipo, alvo: fim.alvo_rotulo, apenas_possiveis: fim.apenas_possiveis, documentos_excluidos: fim.documentos_excluidos, pastas_excluidas: fim.pastas_excluidas, versoes_excluidas: fim.versoes_excluidas,
        bytes_excluidos: Number(fim.bytes_excluidos), mantidos_por_impedimento: fim.bloqueados, iniciada_em: fim.iniciado_em?.toISOString() ?? null, concluida_em: fim.concluido_em?.toISOString() ?? null,
      },
    });
    return "CONCLUIDA";
  } catch (e) {
    console.error("[ged-excluir] exclusão", id, e);
    return falhar("Falha inesperada durante a exclusão. Ela pode ser retomada; o que já foi excluído não volta.");
  }
}

// ───────────── Consulta / retomada ─────────────

function podeVerExclusao(ctx: CtxGed, e: Pick<GedExclusao, "criado_por_id">) {
  return ctx.membro.papel === "GED_ADMIN" || e.criado_por_id === ctx.usuario.id;
}

export async function obterExclusao(ctx: CtxGed, id: string): Promise<ExclusaoView> {
  exigirPodeExcluir(ctx);
  if (!zUuid.safeParse(id).success) exigirEncontrado(null, "Exclusão não encontrada.");
  const e = exigirEncontrado(await ctx.db.gedExclusao.findUnique({ where: { id } }), "Exclusão não encontrada.");
  if (!podeVerExclusao(ctx, e)) exigirEncontrado(null, "Exclusão não encontrada.");
  return paraView(e);
}

export async function listarExclusoes(ctx: CtxGed, limite = 20): Promise<ExclusaoView[]> {
  exigirPodeExcluir(ctx);
  const l = await ctx.db.gedExclusao.findMany({ where: ctx.membro.papel === "GED_ADMIN" ? {} : { criado_por_id: ctx.usuario.id }, orderBy: { created_at: "desc" }, take: Math.min(100, Math.max(1, limite)) });
  return l.map(paraView);
}

/** Exclusão ativa mais recente do alvo (para a tela retomar o acompanhamento). */
export async function exclusaoAtivaDoAlvo(ctx: CtxGed, alvo: AlvoExclusao): Promise<ExclusaoView | null> {
  if (!podeExcluirGed(ctx)) return null;
  const e = await ctx.db.gedExclusao.findFirst({ where: { tipo: alvo.tipo, alvo_id: alvo.id, status: { in: ["PENDENTE", "PROCESSANDO", "FALHOU"] } }, orderBy: { created_at: "desc" } });
  return e && podeVerExclusao(ctx, e) ? paraView(e) : null;
}

/** Retoma uma exclusão que falhou (volta a PENDENTE; o que já foi excluído não é refeito). */
export async function retomarExclusao(ctx: CtxGed, id: string): Promise<ExclusaoView> {
  const atual = await obterExclusao(ctx, id);
  if (atual.status !== "FALHOU") throw new ErroApi(409, "EXCLUSAO_NAO_FALHOU", "Só é possível retomar uma exclusão que falhou.");
  const ativa = await ctx.db.gedExclusao.count({ where: { status: { in: ["PENDENTE", "PROCESSANDO"] } } });
  if (ativa > 0) throw new ErroApi(409, "EXCLUSAO_EM_ANDAMENTO", "Já há uma exclusão em andamento neste cliente.");
  const e = await ctx.db.gedExclusao.update({ where: { id }, data: { status: "PENDENTE", erro: null, concluido_em: null } });
  await auditarGed(ctx, { acao: "GED_EXCLUSAO_RETOMADA", entidade: "ged_exclusao", entidade_id: id, depois: { alvo: e.alvo_rotulo } });
  void iniciarExclusaoAposCriar(ctx.organizacao_id, id);
  return paraView(e);
}

/** Exclusões a processar em TODOS os clientes (PENDENTE, ou PROCESSANDO sem sinal de vida). Só ids; o job usa gedDb(organizacao_id). */
export async function exclusoesPendentes(limite = 10): Promise<{ id: string; organizacao_id: string }[]> {
  const corte = new Date(Date.now() - STALE_EXCLUSAO_MS);
  const out: { id: string; organizacao_id: string }[] = [];
  for (const orgId of await organizacoesGedAtivas()) {
    if (out.length >= limite) break;
    out.push(
      ...(await gedDb(orgId).gedExclusao.findMany({
        where: { OR: [{ status: "PENDENTE" }, { status: "PROCESSANDO", updated_at: { lt: corte } }] },
        orderBy: { created_at: "asc" },
        take: limite - out.length,
        select: { id: true, organizacao_id: true },
      })),
    );
  }
  return out;
}

/** Pré-visualização (só leitura): mesma checagem de papel e de permissão do início. */
export async function previaExclusao(ctx: CtxGed, alvo: AlvoExclusao): Promise<{ plano: PlanoExclusaoPublico; ativa: ExclusaoView | null }> {
  exigirPodeExcluir(ctx);
  if (!zUuid.safeParse(alvo.id).success) exigirEncontrado(null, "Registro não encontrado.");
  const plano = await planejarExclusao(ctx, alvo);
  return { plano: plano.publico, ativa: await exclusaoAtivaDoAlvo(ctx, alvo) };
}
