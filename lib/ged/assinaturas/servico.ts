// Serviço do fluxo de assinatura (docs/ged-design.md §3): solicitar, assinar, recusar, cancelar, comentar.
//
// PERMISSÕES (decisão): SOLICITAR exige a capacidade `solicitar_assinatura` (Admin/Gestor/Usuário), VER e EDITAR **ou**
// ADMINISTRAR no documento. ASSINAR exige a ação ASSINAR (concedida só pela linha de signatário em solicitação aberta –
// regra 4 de permissoes.ts) + a linha GedAssinante PENDENTE do próprio usuário + a vez (modo sequencial). RECUSAR idem.
// CANCELAR: autor da solicitação ou quem tem ADMINISTRAR no documento. Todas as escritas ficam em UMA transação com
// auditoria (auditarGed) e a solicitação é travada (UPDATE da própria linha) para serializar assinaturas concorrentes.
import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { verificarSenha } from "@/lib/auth";
import { ErroApi, invalido, proibido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../contratos";
import { exigirEncontrado } from "../db";
import { podeSolicitarAssinatura } from "../papeis";
import { acoesDoDocumento, carregarDocumentoMin, exigirDocumento } from "../permissoes";
import { lerArquivoGed } from "../storage";
import { cancelarSolicitacoesAbertas } from "./cancelamento";
import { hashElo, ordenarCronologico } from "./cadeia";
import { exigirSemBloqueioSenha, registrarFalhaSenha } from "./limites";
import { avisar, comentarioSeguro, tramiteSeguro } from "./ponte";
import {
  calcularPrazoAssinatura, fmtDataHoraBrasilia, METODO_ELETRONICA_AVANCADA, montarAssinantes, podeAssinarAgora, podeSolicitarNoStatus,
  prazoExpirado, proximosAPromover, REAUTENTICACAO_SENHA, TEXTO_CONSENTIMENTO, todosAssinaram,
} from "./regras";
import { selarDocumento, type ResultadoSelo } from "./selo";
import {
  zAssinar, zCancelar, zComentarAssinatura, zRecusar, zSolicitarAssinatura, type MetaRequisicao,
} from "./validacao";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const conflito = (msg: string) => new ErroApi(409, "CONFLITO", msg);

// ───────────── Solicitar ─────────────

/** Membros do cliente que podem ser escolhidos como signatários (ativos, papel com ação ASSINAR – todos menos Auditor). */
export async function candidatosSignatarios(ctx: CtxGed, q?: string, limite = 300) {
  const termo = (q ?? "").trim();
  const l = await ctx.db.gedMembro.findMany({
    where: {
      ativo: true,
      papel: { not: "GED_AUDITOR" },
      usuario: { is: { ativo: true, organizacao_id: ctx.organizacao_id, ...(termo ? { nome: { contains: termo, mode: "insensitive" as const } } : {}) } },
    },
    select: { papel: true, usuario: { select: { id: true, nome: true, cargo: true } } },
    take: limite,
  });
  return l.map((m) => ({ id: m.usuario.id, nome: m.usuario.nome, cargo: m.usuario.cargo, papel: m.papel })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function solicitarAssinatura(ctx: CtxGed, entrada: unknown): Promise<{ id: string }> {
  const e = zSolicitarAssinatura.parse(entrada);
  if (!podeSolicitarAssinatura(ctx)) throw proibido("Seu papel não permite solicitar assinaturas.");
  const { doc, acoes } = await exigirDocumento(ctx, e.documento_id, "VER");
  if (!acoes.includes("EDITAR") && !acoes.includes("ADMINISTRAR")) throw proibido("Para solicitar assinatura é preciso poder editar ou administrar o documento.");
  if (!podeSolicitarNoStatus(doc.status)) {
    throw conflito(doc.status === "EM_ASSINATURA" ? "Este documento já tem uma solicitação de assinatura aberta." : "Este documento não pode receber nova solicitação de assinatura no estado atual.");
  }
  // signatários: membros ativos do MESMO cliente, com papel que pode assinar
  const validos = await ctx.db.gedMembro.findMany({
    where: { usuario_id: { in: e.signatarios }, ativo: true, papel: { not: "GED_AUDITOR" }, usuario: { is: { ativo: true, organizacao_id: ctx.organizacao_id } } },
    select: { usuario_id: true },
  });
  const ok = new Set(validos.map((v) => v.usuario_id));
  if (e.signatarios.some((id) => !ok.has(id))) throw invalido("Um ou mais signatários não são membros ativos com permissão para assinar neste cliente.");

  const config = await ctx.db.gedConfig.findFirst({ select: { assinatura_prazo_dias: true } });
  const dias = e.prazo_dias ?? config?.assinatura_prazo_dias ?? 15;

  const r = await ctx.db.$transaction(
    async (tx) => {
      // trava o documento: serializa solicitações simultâneas ("só uma aberta por documento")
      const d = await tx.gedDocumento.update({ where: { id: doc.id }, data: { updated_at: new Date() }, select: { id: true, status: true, versao_atual_id: true, numero: true, titulo: true } });
      if (!podeSolicitarNoStatus(d.status)) throw conflito("Este documento já tem uma solicitação de assinatura aberta ou não aceita assinatura agora.");
      if (await tx.gedSolicitacaoAssinatura.findFirst({ where: { documento_id: d.id, status: "ABERTA" }, select: { id: true } })) throw conflito("Este documento já tem uma solicitação de assinatura aberta.");
      if (!d.versao_atual_id) throw invalido("O documento não tem arquivo para assinar.");
      const versao = exigirEncontrado(await tx.gedVersaoDocumento.findFirst({ where: { id: d.versao_atual_id, documento_id: d.id } }), "Versão do documento não encontrada.");
      if (!/pdf/i.test(versao.mime)) throw invalido("Somente documentos em PDF podem ser enviados para assinatura.");
      const arquivo = await lerArquivoGed(ctx.organizacao_id, versao.storage_key);
      const sha256_alvo = sha256(arquivo);
      if (sha256_alvo !== versao.sha256) throw new ErroApi(409, "INTEGRIDADE", "O arquivo armazenado não confere com o hash registrado da versão. A solicitação foi abortada.");

      const agora = new Date();
      const prazo_em = calcularPrazoAssinatura(agora, dias);
      const sol = await tx.gedSolicitacaoAssinatura.create({
        data: { documento_id: d.id, versao_id: versao.id, sha256_alvo, modo: e.modo, status: "ABERTA", prazo_em, mensagem: e.mensagem ?? null, criada_por_id: ctx.usuario.id } as Prisma.GedSolicitacaoAssinaturaUncheckedCreateInput,
        select: { id: true },
      });
      const linhas = montarAssinantes(e.modo, e.signatarios);
      const criados: { id: string; usuario_id: string; status: string }[] = [];
      for (const l of linhas) {
        const a = await tx.gedAssinante.create({ data: { solicitacao_id: sol.id, usuario_id: l.usuario_id, ordem: l.ordem, status: l.status } as Prisma.GedAssinanteUncheckedCreateInput, select: { id: true, usuario_id: true, status: true } });
        criados.push(a);
      }
      await tx.gedDocumento.update({ where: { id: d.id }, data: { status: "EM_ASSINATURA" } });
      if (e.mensagem) await comentarioSeguro(tx, ctx, { documento_id: d.id, versao_id: versao.id, solicitacao_id: sol.id, contexto: "ASSINATURA", texto: e.mensagem });
      for (const a of criados.filter((x) => x.status === "PENDENTE")) {
        await avisar(tx, ctx, "ASSINATURA_SOLICITADA", {
          usuario_ids: [a.usuario_id], documento_id: d.id, assinante_id: a.id,
          dados: { solicitante: ctx.usuario.nome, prazo: fmtDataHoraBrasilia(prazo_em), modo: e.modo, ...(e.mensagem ? { mensagem: e.mensagem.slice(0, 500) } : {}) },
        });
      }
      await auditarGed(
        ctx,
        { acao: "GED_ASSINATURA_SOLICITADA", entidade: "ged_solicitacao_assinatura", entidade_id: sol.id, antes: { status_documento: d.status }, depois: { documento_id: d.id, versao_id: versao.id, versao_n: versao.n, sha256_alvo, modo: e.modo, prazo_em, signatarios: e.signatarios } },
        tx,
      );
      return { id: sol.id };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  return r;
}

// ───────────── Cancelar ─────────────

/** Cancelamento pela pessoa: autor da solicitação ou quem administra o documento. */
export async function cancelarSolicitacao(ctx: CtxGed, entrada: unknown): Promise<void> {
  const e = zCancelar.parse(entrada);
  const sol = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: e.solicitacao_id }, select: { id: true, documento_id: true, criada_por_id: true, status: true } }), "Solicitação não encontrada.");
  const { acoes } = await exigirDocumento(ctx, sol.documento_id, "VER");
  if (sol.criada_por_id !== ctx.usuario.id && !acoes.includes("ADMINISTRAR")) throw proibido("Somente quem solicitou a assinatura (ou um administrador do documento) pode cancelá-la.");
  if (sol.status !== "ABERTA") throw conflito("A solicitação não está mais aberta.");
  await ctx.db.$transaction(async (tx) => {
    const n = await cancelarSolicitacoesAbertas(tx, ctx, sol.documento_id, e.motivo ?? "Cancelada pelo solicitante.");
    if (n === 0) throw conflito("A solicitação não está mais aberta.");
  });
}

// ───────────── Assinar ─────────────

export type ResultadoAssinar = { assinado_em: Date; hash_cadeia: string; concluida: boolean; selo: ResultadoSelo | null; aviso_selo: string | null };

export async function assinar(ctx: CtxGed, entrada: unknown, meta: MetaRequisicao): Promise<ResultadoAssinar> {
  const e = zAssinar.parse(entrada);
  const sol0 = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: e.solicitacao_id }, select: { id: true, documento_id: true } }), "Solicitação não encontrada.");
  // 404 sem VER; 403 sem a ação ASSINAR (não é signatário pendente de solicitação aberta)
  await exigirDocumento(ctx, sol0.documento_id, "ASSINAR", { semMemo: true });

  // reautenticação: senha do próprio signatário (com limite de tentativas)
  exigirSemBloqueioSenha(ctx.usuario.id, meta.ip);
  const u = await ctx.db.usuario.findFirst({ where: { id: ctx.usuario.id, organizacao_id: ctx.organizacao_id, ativo: true }, select: { senha_hash: true } });
  if (!u || !(await verificarSenha(u.senha_hash, e.senha))) {
    const restam = registrarFalhaSenha(ctx.usuario.id, meta.ip);
    await auditarGed(ctx, { acao: "GED_ASSINATURA_SENHA_INVALIDA", entidade: "ged_solicitacao_assinatura", entidade_id: sol0.id, depois: { ip: meta.ip } });
    throw new ErroApi(401, "SENHA_INCORRETA", restam > 0 ? `Senha incorreta. Você ainda tem ${restam} tentativa(s).` : "Senha incorreta. Aguarde alguns minutos antes de tentar de novo.");
  }

  let concluir = false;
  let registro: { assinado_em: Date; hash_cadeia: string };
  try {
    registro = await ctx.db.$transaction(
      async (tx) => {
        // trava a solicitação (serializa assinaturas concorrentes) e relê TUDO já com o trinco
        const sol = await tx.gedSolicitacaoAssinatura.update({ where: { id: sol0.id }, data: { updated_at: new Date() } });
        if (sol.status !== "ABERTA") throw conflito("Esta solicitação não está mais aberta.");
        const agora = new Date();
        if (prazoExpirado(sol.prazo_em, agora)) throw conflito("O prazo desta solicitação terminou.");
        const todos = await tx.gedAssinante.findMany({ where: { solicitacao_id: sol.id }, orderBy: { ordem: "asc" } });
        const meu = todos.find((a) => a.usuario_id === ctx.usuario.id);
        if (!meu) throw proibido("Você não é signatário desta solicitação.");
        if (meu.status === "ASSINADO") throw conflito("Você já assinou este documento.");
        if (meu.status !== "PENDENTE") throw conflito(meu.status === "AGUARDANDO" ? "Ainda não é a sua vez de assinar: aguarde os signatários anteriores." : "Sua assinatura não está mais pendente.");
        if (!podeAssinarAgora(sol.modo, todos, meu.id)) throw conflito("Ainda não é a sua vez de assinar: aguarde os signatários anteriores.");

        // o arquivo assinado é EXATAMENTE o que foi solicitado
        const versao = exigirEncontrado(await tx.gedVersaoDocumento.findFirst({ where: { id: sol.versao_id, documento_id: sol.documento_id } }), "Versão não encontrada.");
        const arquivo = await lerArquivoGed(ctx.organizacao_id, versao.storage_key);
        const hash_documento = sha256(arquivo);
        if (hash_documento !== sol.sha256_alvo) {
          throw new ErroApi(409, "INTEGRIDADE", "O arquivo do documento não confere com o que foi enviado para assinatura (foi alterado). A assinatura foi abortada.");
        }

        // horário do servidor, estritamente crescente dentro da solicitação (ordem cronológica estável para a cadeia)
        const assinadas = ordenarCronologico(todos.filter((a) => a.status === "ASSINADO"));
        const ultima = assinadas[assinadas.length - 1];
        let quando = agora;
        if (ultima?.assinado_em && quando.getTime() <= ultima.assinado_em.getTime()) quando = new Date(ultima.assinado_em.getTime() + 1);
        const anterior = ultima?.hash_cadeia ?? sol.sha256_alvo;
        const hash_cadeia = hashElo(anterior, { assinante_id: meu.id, usuario_id: meu.usuario_id, hash_documento, assinado_em: quando, metodo: METODO_ELETRONICA_AVANCADA });

        const r = await tx.gedAssinante.updateMany({
          where: { id: meu.id, status: "PENDENTE" },
          data: {
            status: "ASSINADO", assinado_em: quando, metodo: METODO_ELETRONICA_AVANCADA, reautenticacao: REAUTENTICACAO_SENHA,
            ip: meta.ip, user_agent: meta.user_agent, hash_documento, hash_cadeia,
          },
        });
        if (r.count !== 1) throw conflito("Esta assinatura já foi registrada.");

        const depois = todos.map((a) => (a.id === meu.id ? { ...a, status: "ASSINADO" as const } : a));
        for (const id of proximosAPromover(sol.modo, depois)) {
          const prox = await tx.gedAssinante.update({ where: { id }, data: { status: "PENDENTE" }, select: { id: true, usuario_id: true } });
          await avisar(tx, ctx, "ASSINATURA_SOLICITADA", {
            usuario_ids: [prox.usuario_id], documento_id: sol.documento_id, assinante_id: prox.id,
            dados: { solicitante: ctx.usuario.nome, prazo: fmtDataHoraBrasilia(sol.prazo_em), modo: sol.modo, sua_vez: "1" },
          });
        }
        concluir = todosAssinaram(depois);
        await auditarGed(
          ctx,
          {
            acao: "GED_ASSINATURA_ASSINADA", entidade: "ged_assinante", entidade_id: meu.id,
            antes: { status: "PENDENTE" },
            depois: { solicitacao_id: sol.id, documento_id: sol.documento_id, metodo: METODO_ELETRONICA_AVANCADA, reautenticacao: REAUTENTICACAO_SENHA, assinado_em: quando, hash_documento, hash_cadeia, ip: meta.ip, consentimento_sha256: sha256(TEXTO_CONSENTIMENTO), ultima_assinatura: concluir },
          },
          tx,
        );
        return { assinado_em: quando, hash_cadeia };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (err) {
    if (err instanceof ErroApi && err.code === "INTEGRIDADE") {
      await auditarGed(ctx, { acao: "GED_ASSINATURA_ABORTADA_INTEGRIDADE", entidade: "ged_solicitacao_assinatura", entidade_id: sol0.id, depois: { motivo: err.message } }).catch(() => undefined);
    }
    throw err;
  }

  // Última assinatura: sela. Falha aqui NÃO desfaz a assinatura (já registrada): a solicitação fica ABERTA com todas as
  // assinaturas e o job `ged-assinaturas` (ou o botão "Tentar selar novamente") conclui – o selo é idempotente.
  if (concluir) {
    try {
      const selo = await selarDocumento(ctx, sol0.id);
      return { ...registro, concluida: true, selo, aviso_selo: null };
    } catch (err) {
      console.error("[ged-assinaturas] selo pendente", sol0.id, err instanceof Error ? err.message : err);
      await auditarGed(ctx, { acao: "GED_SELO_FALHOU", entidade: "ged_solicitacao_assinatura", entidade_id: sol0.id, depois: { erro: err instanceof Error ? err.message.slice(0, 300) : "erro" } }).catch(() => undefined);
      return { ...registro, concluida: true, selo: null, aviso_selo: "Sua assinatura foi registrada, mas o selo do documento ainda não pôde ser concluído; será refeito automaticamente em instantes." };
    }
  }
  return { ...registro, concluida: false, selo: null, aviso_selo: null };
}

/** Tenta (de novo) selar uma solicitação com todas as assinaturas. Autor ou administrador do documento. */
export async function tentarSelar(ctx: CtxGed, solicitacaoId: string): Promise<ResultadoSelo> {
  const sol = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: solicitacaoId }, select: { documento_id: true, criada_por_id: true } }), "Solicitação não encontrada.");
  const { acoes } = await exigirDocumento(ctx, sol.documento_id, "VER");
  if (sol.criada_por_id !== ctx.usuario.id && !acoes.includes("ADMINISTRAR")) throw proibido("Somente quem solicitou (ou um administrador do documento) pode refazer o selo.");
  return selarDocumento(ctx, solicitacaoId);
}

// ───────────── Recusar ─────────────

export async function recusar(ctx: CtxGed, entrada: unknown, meta: MetaRequisicao): Promise<void> {
  const e = zRecusar.parse(entrada);
  const sol0 = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: e.solicitacao_id }, select: { id: true, documento_id: true } }), "Solicitação não encontrada.");
  await exigirDocumento(ctx, sol0.documento_id, "ASSINAR", { semMemo: true });
  await ctx.db.$transaction(
    async (tx) => {
      const sol = await tx.gedSolicitacaoAssinatura.update({ where: { id: sol0.id }, data: { updated_at: new Date() } });
      if (sol.status !== "ABERTA") throw conflito("Esta solicitação não está mais aberta.");
      const todos = await tx.gedAssinante.findMany({ where: { solicitacao_id: sol.id }, orderBy: { ordem: "asc" } });
      const meu = todos.find((a) => a.usuario_id === ctx.usuario.id);
      if (!meu) throw proibido("Você não é signatário desta solicitação.");
      if (!podeAssinarAgora(sol.modo, todos, meu.id)) throw conflito(meu.status === "AGUARDANDO" ? "Ainda não é a sua vez: aguarde os signatários anteriores." : "Sua participação nesta solicitação já foi concluída.");
      const agora = new Date();
      const r = await tx.gedAssinante.updateMany({
        where: { id: meu.id, status: "PENDENTE" },
        data: { status: "RECUSADO", recusado_em: agora, justificativa_recusa: e.justificativa, ip: meta.ip, user_agent: meta.user_agent },
      });
      if (r.count !== 1) throw conflito("Sua resposta já foi registrada.");
      await tx.gedSolicitacaoAssinatura.update({ where: { id: sol.id }, data: { status: "RECUSADA", concluida_em: agora } });
      await tx.gedDocumento.update({ where: { id: sol.documento_id }, data: { status: "RECUSADO" } });
      await comentarioSeguro(tx, ctx, { documento_id: sol.documento_id, versao_id: sol.versao_id, solicitacao_id: sol.id, contexto: "RECUSA", texto: e.justificativa });
      await tramiteSeguro(tx, ctx, { documento_id: sol.documento_id, tipo: "RECUSA", despacho: `Assinatura recusada: ${e.justificativa}` });
      await avisar(tx, ctx, "ASSINATURA_RECUSADA", {
        usuario_ids: [sol.criada_por_id], documento_id: sol.documento_id, assinante_id: meu.id,
        dados: { recusado_por: ctx.usuario.nome, justificativa: e.justificativa.slice(0, 500) },
      });
      await auditarGed(
        ctx,
        { acao: "GED_ASSINATURA_RECUSADA", entidade: "ged_assinante", entidade_id: meu.id, antes: { status: "PENDENTE" }, depois: { solicitacao_id: sol.id, documento_id: sol.documento_id, justificativa: e.justificativa, recusado_em: agora, ip: meta.ip } },
        tx,
      );
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

// ───────────── Comentários no contexto da assinatura ─────────────

/** Autor da solicitação ou qualquer signatário comenta enquanto a solicitação está aberta (antes e durante as assinaturas). */
export async function comentarAssinatura(ctx: CtxGed, entrada: unknown): Promise<{ id: string }> {
  const e = zComentarAssinatura.parse(entrada);
  const sol = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: e.solicitacao_id }, select: { id: true, documento_id: true, versao_id: true, criada_por_id: true, status: true } }), "Solicitação não encontrada.");
  await exigirDocumento(ctx, sol.documento_id, "VER", { semMemo: true });
  const participa = sol.criada_por_id === ctx.usuario.id || (await ctx.db.gedAssinante.count({ where: { solicitacao_id: sol.id, usuario_id: ctx.usuario.id } })) > 0;
  if (!participa) throw proibido("Somente o autor da solicitação e os signatários comentam neste fluxo.");
  if (sol.status !== "ABERTA") throw conflito("A solicitação foi encerrada; comente pela conversa geral do documento.");
  return ctx.db.$transaction((tx) => comentarioSeguroObrigatorio(tx, ctx, { documento_id: sol.documento_id, versao_id: sol.versao_id, solicitacao_id: sol.id, contexto: "ASSINATURA", texto: e.texto }));
}

async function comentarioSeguroObrigatorio(...a: Parameters<typeof comentarioSeguro>) {
  const r = await comentarioSeguro(...a);
  if (!r) throw invalido("O serviço de comentários ainda não está disponível.");
  return r;
}

// ───────────── Visualização (evidência de leitura) ─────────────

/** Marca que o signatário abriu o documento (1ª vez). Não altera linhas já decididas (trigger do banco). */
export async function registrarVisualizacao(ctx: CtxGed, solicitacaoId: string): Promise<void> {
  await ctx.db.gedAssinante.updateMany({
    where: { solicitacao_id: solicitacaoId, usuario_id: ctx.usuario.id, visualizou_em: null, status: { in: ["PENDENTE", "AGUARDANDO"] } },
    data: { visualizou_em: new Date() },
  });
}

/** (uso interno/tests) ações do usuário no documento da solicitação. */
export async function acoesNaSolicitacao(ctx: CtxGed, solicitacaoId: string) {
  const s = await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: solicitacaoId }, select: { documento_id: true } });
  if (!s) return [];
  const doc = await carregarDocumentoMin(ctx, s.documento_id);
  return doc ? acoesDoDocumento(ctx, doc, { semMemo: true }) : [];
}
