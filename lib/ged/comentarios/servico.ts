// Comentários do documento (contrato em lib/ged/contratos.ts). Append-only (trigger no banco): sem edição/exclusão.
// `registrarComentario` roda na transação do chamador, sem checar permissão (também usado pelo fluxo de assinatura – D –
// com contexto ASSINATURA/RECUSA). `comentar` é a porta de entrada da UI/API: exige VER, aplica o limite de ritmo e abre a transação.
//
// REGRA: qualquer pessoa com VER no documento pode comentar (inclusive GED_LEITOR/GED_AUDITOR com acesso) – o comentário
// não altera o documento. Documento ASSINADO/ARQUIVADO também aceita comentário (conversa posterior), pois é só registro.
import type { Prisma } from "@prisma/client";
import { ErroApi, invalido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import type { CtxGed, GedTx, RegistrarComentarioInput } from "../contratos";
import { exigirEncontrado } from "../db";
import { exigirDocumento } from "../permissoes";
import { excedeuLimite, LIMITE_COMENTARIOS, MENSAGEM_LIMITE, normalizarTextoComentario, validarContexto } from "./regras";

/** Registra um comentário (append-only) no documento. */
export async function registrarComentario(tx: GedTx, ctx: CtxGed, input: RegistrarComentarioInput): Promise<{ id: string }> {
  const contexto = validarContexto(input.contexto);
  const texto = normalizarTextoComentario(input.texto);
  exigirEncontrado(await tx.gedDocumento.findUnique({ where: { id: input.documento_id }, select: { id: true } }), "Documento não encontrado.");
  if (input.versao_id) {
    const v = await tx.gedVersaoDocumento.findFirst({ where: { id: input.versao_id, documento_id: input.documento_id }, select: { id: true } });
    if (!v) throw invalido("Versão não pertence a este documento.");
  }
  if (input.solicitacao_id) {
    const s = await tx.gedSolicitacaoAssinatura.findFirst({ where: { id: input.solicitacao_id, documento_id: input.documento_id }, select: { id: true } });
    if (!s) throw invalido("Solicitação não pertence a este documento.");
  }
  const c = await tx.gedComentario.create({
    data: {
      documento_id: input.documento_id,
      versao_id: input.versao_id ?? null,
      solicitacao_id: input.solicitacao_id ?? null,
      autor_id: ctx.usuario.id,
      contexto,
      texto,
    } as Prisma.GedComentarioUncheckedCreateInput,
    select: { id: true },
  });
  await auditarGed(ctx, { acao: "GED_COMENTARIO_CRIADO", entidade: "ged_comentario", entidade_id: c.id, depois: { documento_id: input.documento_id, contexto, versao_id: input.versao_id ?? null, solicitacao_id: input.solicitacao_id ?? null, tamanho: texto.length } }, tx);
  return { id: c.id };
}

/** UI/API: exige VER (404 sem acesso), aplica limite de ritmo (429) e grava no contexto GERAL (ou TRAMITE, se pedido). */
export async function comentar(ctx: CtxGed, entrada: { documento_id: string; texto: string; contexto?: "GERAL" | "TRAMITE"; versao_id?: string }): Promise<{ id: string }> {
  await exigirDocumento(ctx, entrada.documento_id, "VER");
  const contexto = entrada.contexto === "TRAMITE" ? "TRAMITE" : "GERAL";
  return ctx.db.$transaction(async (tx) => {
    const recentes = await tx.gedComentario.count({
      where: { autor_id: ctx.usuario.id, created_at: { gt: new Date(Date.now() - LIMITE_COMENTARIOS.janela_ms) } },
    });
    if (excedeuLimite(recentes)) throw new ErroApi(429, "LIMITE_EXCEDIDO", MENSAGEM_LIMITE);
    return registrarComentario(tx, ctx, { documento_id: entrada.documento_id, versao_id: entrada.versao_id, contexto, texto: entrada.texto });
  });
}

export type ComentarioView = {
  id: string;
  autor_id: string;
  autor_nome: string;
  contexto: string;
  texto: string;
  versao_n: number | null;
  created_at: Date;
};

/** Comentários do documento (mais antigos primeiro). Exige VER. */
export async function listarComentarios(ctx: CtxGed, documentoId: string, opc: { take?: number } = {}): Promise<ComentarioView[]> {
  await exigirDocumento(ctx, documentoId, "VER");
  const l = await ctx.db.gedComentario.findMany({
    where: { documento_id: documentoId },
    orderBy: { created_at: "asc" },
    take: opc.take ?? 500,
    select: { id: true, autor_id: true, contexto: true, texto: true, versao_id: true, created_at: true },
  });
  const autores = await ctx.db.usuario.findMany({ where: { id: { in: [...new Set(l.map((c) => c.autor_id))] }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true } });
  const nomes = new Map(autores.map((a) => [a.id, a.nome]));
  const vids = [...new Set(l.flatMap((c) => (c.versao_id ? [c.versao_id] : [])))];
  const versoes = vids.length ? await ctx.db.gedVersaoDocumento.findMany({ where: { id: { in: vids }, documento_id: documentoId }, select: { id: true, n: true } }) : [];
  const ns = new Map(versoes.map((v) => [v.id, v.n]));
  return l.map((c) => ({ id: c.id, autor_id: c.autor_id, autor_nome: nomes.get(c.autor_id) ?? "Usuário", contexto: c.contexto, texto: c.texto, versao_n: c.versao_id ? (ns.get(c.versao_id) ?? null) : null, created_at: c.created_at }));
}
