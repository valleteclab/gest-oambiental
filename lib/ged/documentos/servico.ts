// Serviço de documentos (frente B): criar por upload, editar metadados, arquivar/restaurar, marca de dados pessoais.
// Cada função refaz a checagem de permissão (Server Actions e rotas chamam o mesmo serviço) e audita na mesma transação.
//   criar ................ papel com `criar_documento` + EDITAR na pasta de destino (se houver)
//   editar metadados ..... EDITAR; mover de pasta e mudar sensibilidade exigem ADMINISTRAR (alteram quem enxerga)
//   arquivar/restaurar ... ADMINISTRAR (descrição de ADMINISTRAR: "gerenciar permissões, mover e arquivar")
//   dados pessoais ....... ANONIMIZAR ou EDITAR
import { Prisma, type GedSensibilidade, type GedStatusDocumento } from "@prisma/client";
import { z } from "zod";
import { invalido, proibido } from "@/lib/http";
import { aplicarMarcaDadosPessoais, erroSensibilidade } from "../anonimizacao";
import { concederAclAoCriador } from "../acl";
import { auditarGed } from "../auditoria";
import type { CtxGed } from "../contratos";
import { exigirEncontrado } from "../db";
import { podeCriarDocumento } from "../papeis";
import { proximoNumeroGed } from "../numeracao";
import { exigirDocumento, exigirPasta } from "../permissoes";
import { exigirUploadGedValido } from "../storage";
import { zSensibilidade, zUuid } from "../tipos";
import { iniciarExtracaoAposUpload } from "./extracao";
import { dataValida } from "./filtros";
import { criarVersao } from "./versoes";

const vazioParaNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const zMetadadosDocumento = z.object({
  titulo: z.string().trim().min(3, "O título precisa de ao menos 3 caracteres.").max(250, "Título com até 250 caracteres."),
  tipo_id: z.preprocess(vazioParaNull, zUuid.nullable().optional()),
  remetente: z.preprocess(vazioParaNull, z.string().trim().max(200, "Remetente com até 200 caracteres.").nullable().optional()),
  data_documento: z.preprocess(vazioParaNull, z.string().refine(dataValida, "Data do documento inválida.").nullable().optional()),
  pasta_id: z.preprocess(vazioParaNull, zUuid.nullable().optional()),
  sensibilidade: z.preprocess((v) => (v === "" || v === null ? undefined : v), zSensibilidade.optional()),
  marcador_ids: z.array(zUuid).max(30).optional(),
});
export type MetadadosDocumento = z.input<typeof zMetadadosDocumento>;

export type EntradaUpload = MetadadosDocumento & { arquivo: Buffer; nome_arquivo: string; mime: string };

const dataDe = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

async function exigirTipoDoTenant(ctx: CtxGed, tipoId: string | null | undefined) {
  if (!tipoId) return;
  const t = await ctx.db.gedTipoDocumento.findUnique({ where: { id: tipoId }, select: { id: true } });
  if (!t) throw invalido("Tipo de documento não encontrado.");
}

/** Cria o documento a partir de um PDF enviado (status PUBLICADO) + versão 1 + ACL do criador. */
export async function criarDocumentoUpload(ctx: CtxGed, entrada: EntradaUpload): Promise<{ id: string; numero: string; versao_id: string }> {
  if (!podeCriarDocumento(ctx)) throw proibido("Seu papel não permite criar documentos.");
  const m = zMetadadosDocumento.parse(entrada);
  const arq = exigirUploadGedValido(entrada.arquivo, entrada.nome_arquivo, entrada.mime);
  await exigirTipoDoTenant(ctx, m.tipo_id);
  let sensibilidade: GedSensibilidade = m.sensibilidade ?? "RESTRITO";
  if (m.pasta_id) {
    await exigirPasta(ctx, m.pasta_id, "EDITAR");
    if (!m.sensibilidade) {
      const p = await ctx.db.gedPasta.findUnique({ where: { id: m.pasta_id }, select: { sensibilidade_padrao: true, excluido_em: true } });
      if (!p || p.excluido_em) throw invalido("Pasta não encontrada.");
      sensibilidade = p.sensibilidade_padrao;
    }
  }
  const marcadorIds = m.marcador_ids ?? [];
  if (marcadorIds.length) {
    const ok = await ctx.db.gedMarcador.count({ where: { id: { in: marcadorIds } } });
    if (ok !== new Set(marcadorIds).size) throw invalido("Marcador não encontrado.");
  }
  const r = await ctx.db.$transaction(async (tx) => {
    const numero = await proximoNumeroGed(tx, ctx.organizacao_id, "DOC");
    const doc = await tx.gedDocumento.create({
      data: {
        numero,
        titulo: m.titulo,
        tipo_id: m.tipo_id ?? null,
        remetente: m.remetente ?? null,
        data_documento: dataDe(m.data_documento),
        pasta_id: m.pasta_id ?? null,
        status: "PUBLICADO",
        sensibilidade,
        criado_por_id: ctx.usuario.id,
      } as Prisma.GedDocumentoUncheckedCreateInput,
      select: { id: true, numero: true },
    });
    const v = await criarVersao(tx, ctx, { documento_id: doc.id, origem: "UPLOAD", arquivo: entrada.arquivo, nome_arquivo: arq.nome, mime: arq.mime });
    if (marcadorIds.length) {
      await tx.gedDocumentoMarcador.createMany({ data: [...new Set(marcadorIds)].map((marcador_id) => ({ documento_id: doc.id, marcador_id })) as Prisma.GedDocumentoMarcadorCreateManyInput[] });
    }
    await concederAclAoCriador(tx, ctx, { tipo: "documento", id: doc.id });
    await auditarGed(
      ctx,
      { acao: "GED_DOCUMENTO_CRIADO", entidade: "ged_documento", entidade_id: doc.id, depois: { numero: doc.numero, titulo: m.titulo, pasta_id: m.pasta_id ?? null, sensibilidade, origem: "UPLOAD", sha256: v.sha256 } },
      tx,
    );
    return { id: doc.id, numero: doc.numero, versao_id: v.id };
  });
  void iniciarExtracaoAposUpload(ctx.organizacao_id, r.versao_id).catch(() => {});
  return r;
}

export const zEdicaoDocumento = zMetadadosDocumento.omit({ marcador_ids: true }).partial({ titulo: true });
export type EdicaoDocumento = z.input<typeof zEdicaoDocumento>;

/** Atualiza metadados. Só os campos presentes em `entrada` são alterados (null/"" limpa tipo, remetente, data, pasta). */
export async function atualizarMetadadosDocumento(ctx: CtxGed, documentoId: string, entrada: Record<string, unknown>): Promise<void> {
  const e = zEdicaoDocumento.parse(entrada);
  const tem = (k: string) => Object.prototype.hasOwnProperty.call(entrada, k);
  const { doc: atual, acoes } = await exigirDocumento(ctx, documentoId, "EDITAR");
  const mudaPasta = tem("pasta_id") && (e.pasta_id ?? null) !== atual.pasta_id;
  const mudaSens = tem("sensibilidade") && e.sensibilidade !== undefined && e.sensibilidade !== atual.sensibilidade;
  if ((mudaPasta || mudaSens) && !acoes.includes("ADMINISTRAR")) throw proibido("Mover o documento ou alterar a sensibilidade exige a permissão Administrar.");
  if (tem("tipo_id")) await exigirTipoDoTenant(ctx, e.tipo_id);
  if (mudaPasta && e.pasta_id) await exigirPasta(ctx, e.pasta_id, "EDITAR");
  await ctx.db.$transaction(async (tx) => {
    const antes = exigirEncontrado(await tx.gedDocumento.findUnique({ where: { id: documentoId } }), "Documento não encontrado.");
    const data: Prisma.GedDocumentoUncheckedUpdateInput = {};
    if (tem("titulo") && e.titulo !== undefined) data.titulo = e.titulo;
    if (tem("tipo_id")) data.tipo_id = e.tipo_id ?? null;
    if (tem("remetente")) data.remetente = e.remetente ?? null;
    if (tem("data_documento")) data.data_documento = dataDe(e.data_documento);
    if (mudaPasta) data.pasta_id = e.pasta_id ?? null;
    if (mudaSens && e.sensibilidade) {
      const erro = erroSensibilidade(e.sensibilidade, antes);
      if (erro) throw invalido(erro);
      data.sensibilidade = e.sensibilidade;
    }
    await tx.gedDocumento.update({ where: { id: documentoId }, data });
    await auditarGed(
      ctx,
      {
        acao: "GED_DOCUMENTO_ATUALIZADO",
        entidade: "ged_documento",
        entidade_id: documentoId,
        antes: { titulo: antes.titulo, tipo_id: antes.tipo_id, remetente: antes.remetente, data_documento: antes.data_documento, pasta_id: antes.pasta_id, sensibilidade: antes.sensibilidade },
        depois: data,
      },
      tx,
    );
  });
}

/** Arquiva (status ARQUIVADO). Não arquiva documento com assinatura em andamento. */
export async function arquivarDocumento(ctx: CtxGed, documentoId: string): Promise<void> {
  await exigirDocumento(ctx, documentoId, "ADMINISTRAR");
  await ctx.db.$transaction(async (tx) => {
    const d = exigirEncontrado(await tx.gedDocumento.findUnique({ where: { id: documentoId }, select: { status: true, titulo: true } }), "Documento não encontrado.");
    if (d.status === "ARQUIVADO") return;
    if (d.status === "EM_ASSINATURA") throw invalido("Há uma assinatura em andamento. Cancele a solicitação antes de arquivar.");
    await tx.gedDocumento.update({ where: { id: documentoId }, data: { status: "ARQUIVADO" } });
    await auditarGed(ctx, { acao: "GED_DOCUMENTO_ARQUIVADO", entidade: "ged_documento", entidade_id: documentoId, antes: { status: d.status }, depois: { status: "ARQUIVADO" } }, tx);
  });
}

/** Status a restaurar: o registrado na auditoria do arquivamento; senão ASSINADO (se selado) ou PUBLICADO. */
export function statusAoRestaurar(anterior: unknown, selado: boolean): GedStatusDocumento {
  const validos: GedStatusDocumento[] = ["RASCUNHO", "PUBLICADO", "RECUSADO", "ASSINADO"];
  if (typeof anterior === "string" && (validos as string[]).includes(anterior)) return anterior as GedStatusDocumento;
  return selado ? "ASSINADO" : "PUBLICADO";
}

export async function restaurarDocumento(ctx: CtxGed, documentoId: string): Promise<void> {
  await exigirDocumento(ctx, documentoId, "ADMINISTRAR");
  await ctx.db.$transaction(async (tx) => {
    const d = exigirEncontrado(await tx.gedDocumento.findUnique({ where: { id: documentoId }, select: { status: true, codigo_verificador: true } }), "Documento não encontrado.");
    if (d.status !== "ARQUIVADO") return;
    const log = await tx.logAuditoria.findFirst({
      where: { organizacao_id: ctx.organizacao_id, entidade: "ged_documento", entidade_id: documentoId, acao: "GED_DOCUMENTO_ARQUIVADO" },
      orderBy: { created_at: "desc" },
      select: { antes: true },
    });
    const anterior = (log?.antes as { status?: string } | null)?.status;
    const novo = statusAoRestaurar(anterior, d.codigo_verificador !== null);
    await tx.gedDocumento.update({ where: { id: documentoId }, data: { status: novo } });
    await auditarGed(ctx, { acao: "GED_DOCUMENTO_RESTAURADO", entidade: "ged_documento", entidade_id: documentoId, antes: { status: "ARQUIVADO" }, depois: { status: novo } }, tx);
  });
}

/**
 * Marca/desmarca "contém dados pessoais" (ANONIMIZAR ou EDITAR). Marcado e ainda não anonimizado → anonimização PENDENTE
 * e, se estava PUBLICO, sensibilidade vira RESTRITO (o CHECK do banco proíbe PENDENTE + PUBLICO).
 */
export async function definirDadosPessoais(ctx: CtxGed, documentoId: string, contem: boolean): Promise<{ sensibilidade_rebaixada: boolean }> {
  const { acoes } = await exigirDocumento(ctx, documentoId, "VER");
  if (!acoes.includes("ANONIMIZAR") && !acoes.includes("EDITAR")) throw proibido("Você não tem permissão para marcar dados pessoais neste documento.");
  return ctx.db.$transaction(async (tx) => {
    const d = exigirEncontrado(await tx.gedDocumento.findUnique({ where: { id: documentoId }, select: { sensibilidade: true, contem_dados_pessoais: true, anonimizacao_status: true } }), "Documento não encontrado.");
    const r = aplicarMarcaDadosPessoais(d, contem);
    await tx.gedDocumento.update({ where: { id: documentoId }, data: { contem_dados_pessoais: r.contem_dados_pessoais, anonimizacao_status: r.anonimizacao_status, sensibilidade: r.sensibilidade } });
    await auditarGed(ctx, { acao: "GED_DOCUMENTO_DADOS_PESSOAIS", entidade: "ged_documento", entidade_id: documentoId, antes: d, depois: { contem_dados_pessoais: r.contem_dados_pessoais, anonimizacao_status: r.anonimizacao_status, sensibilidade: r.sensibilidade } }, tx);
    return { sensibilidade_rebaixada: r.sensibilidade_rebaixada };
  });
}

/** Envia um novo PDF como próxima versão (exige EDITAR; documento assinado/selado recusa; assinatura em andamento: cancele antes). */
export async function enviarNovaVersao(ctx: CtxGed, documentoId: string, arq: { arquivo: Buffer; nome_arquivo: string; mime: string }): Promise<{ versao_id: string; n: number }> {
  await exigirDocumento(ctx, documentoId, "EDITAR");
  const v = exigirUploadGedValido(arq.arquivo, arq.nome_arquivo, arq.mime);
  const r = await ctx.db.$transaction(async (tx) => {
    const d = exigirEncontrado(await tx.gedDocumento.findUnique({ where: { id: documentoId }, select: { status: true } }), "Documento não encontrado.");
    if (d.status === "EM_ASSINATURA") throw invalido("Há uma assinatura em andamento. Cancele a solicitação antes de enviar uma nova versão.");
    if (d.status === "ARQUIVADO") throw invalido("Restaure o documento antes de enviar uma nova versão.");
    return criarVersao(tx, ctx, { documento_id: documentoId, origem: "UPLOAD", arquivo: arq.arquivo, nome_arquivo: v.nome, mime: v.mime });
  });
  void iniciarExtracaoAposUpload(ctx.organizacao_id, r.id).catch(() => {});
  return { versao_id: r.id, n: r.n };
}

/** Pede nova extração do texto da versão atual (ERRO/SEM_TEXTO → PENDENTE). Exige EDITAR. */
export async function reprocessarTextoDocumento(ctx: CtxGed, documentoId: string): Promise<void> {
  await exigirDocumento(ctx, documentoId, "EDITAR");
  const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: documentoId }, select: { versao_atual_id: true } }), "Documento não encontrado.");
  if (!d.versao_atual_id) throw invalido("O documento ainda não tem arquivo.");
  const { reprocessarTexto } = await import("./extracao");
  if (await reprocessarTexto(ctx.organizacao_id, d.versao_atual_id)) void iniciarExtracaoAposUpload(ctx.organizacao_id, d.versao_atual_id).catch(() => {});
}
