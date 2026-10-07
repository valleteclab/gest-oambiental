// Configuração do protocolo online (portal do cidadão) – somente GED_ADMIN, tudo auditado. O recurso nasce DESLIGADO.
// Para ligar é preciso: endereço público (slug) válido e único na plataforma, responsável (membro que guarda o que chega),
// ao menos um assunto ativo e cada assunto apontando para um setor com participante apto a receber.
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { invalido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import { exigirEncontrado, slugPortalEmUso } from "../db";
import type { CtxGed } from "../escopo";
import { exigirAdmin } from "../admin/membros";
import { baseUrlApp } from "../assinaturas/regras";
import { resolverDestinatario } from "../tramite/servico";
import { erroSlug, limitesAnexos, LIMITE_MAX_ANEXOS, LIMITE_MAX_MB, normalizarSlug, PAPEIS_QUE_RECEBEM } from "./regras";

const vazio = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());

export const zConfigProtocolo = z.object({
  portal_ativo: bool,
  slug: z.preprocess(vazio, z.string().trim().max(80).nullable().optional()),
  orientacao: z.preprocess(vazio, z.string().trim().max(2000, "Orientação com até 2000 caracteres.").nullable().optional()),
  max_anexos: z.coerce.number().int("Número de arquivos inválido.").min(0, "Mínimo 0.").max(LIMITE_MAX_ANEXOS, `No máximo ${LIMITE_MAX_ANEXOS} arquivos.`),
  max_mb: z.coerce.number().int("Tamanho inválido.").min(1, "Mínimo 1 MB.").max(LIMITE_MAX_MB, `No máximo ${LIMITE_MAX_MB} MB por arquivo.`),
  responsavel_id: z.preprocess(vazio, z.string().uuid("Responsável inválido.").nullable().optional()),
});

export const zAssunto = z.object({
  nome: z.string().trim().min(3, "Informe o nome do assunto (mínimo de 3 caracteres).").max(120, "Nome com até 120 caracteres."),
  descricao: z.preprocess(vazio, z.string().trim().max(300, "Descrição com até 300 caracteres.").nullable().optional()),
  destino_setor_id: z.string().uuid("Escolha o setor de destino."),
  tipo_documento_id: z.preprocess(vazio, z.string().uuid().nullable().optional()),
  prioridade: z.preprocess(vazio, z.enum(["BAIXA", "NORMAL", "ALTA", "URGENTE"]).default("NORMAL")),
  prazo_dias: z.preprocess(vazio, z.coerce.number().int("Prazo inválido.").min(1, "Prazo mínimo de 1 dia.").max(365, "Prazo máximo de 365 dias.").nullable().optional()),
  ordem: z.preprocess(vazio, z.coerce.number().int().min(0).max(999).default(0)),
});

export type AssuntoView = {
  id: string; nome: string; descricao: string | null; destino_setor_id: string; destino_setor: string | null; tipo_documento_id: string | null;
  prioridade: "BAIXA" | "NORMAL" | "ALTA" | "URGENTE"; prazo_dias: number | null; ativo: boolean; ordem: number;
};
export type ConfigProtocoloView = {
  portal_ativo: boolean; slug: string | null; url_publica: string | null; orientacao: string | null; max_anexos: number; max_mb: number; responsavel_id: string | null;
  assuntos: AssuntoView[];
  responsaveis: { id: string; nome: string }[];
  setores: { id: string; nome: string }[];
  tipos: { id: string; nome: string }[];
};

export const urlPortal = (slug: string | null, base: string = baseUrlApp()) => (slug ? `${base.replace(/\/+$/, "")}/protocolo/${slug}` : null);

export async function lerConfigProtocolo(ctx: CtxGed): Promise<ConfigProtocoloView> {
  exigirAdmin(ctx);
  const [cfg, org, assuntos, membros, setores, tipos] = await Promise.all([
    ctx.db.gedConfig.findFirst({ select: { protocolo_portal_ativo: true, protocolo_orientacao: true, protocolo_max_anexos: true, protocolo_max_mb: true, protocolo_responsavel_id: true } }),
    ctx.db.organizacao.findUnique({ where: { id: ctx.organizacao_id }, select: { slug_publico: true } }),
    ctx.db.gedProtocoloAssunto.findMany({ orderBy: [{ ativo: "desc" }, { ordem: "asc" }, { nome: "asc" }] }),
    ctx.db.gedMembro.findMany({ where: { ativo: true, papel: { in: PAPEIS_QUE_RECEBEM.filter((p) => p !== "GED_LEITOR") }, usuario: { is: { ativo: true, organizacao_id: ctx.organizacao_id } } }, select: { usuario: { select: { id: true, nome: true } } } }),
    ctx.db.gedSetor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    ctx.db.gedTipoDocumento.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const nomeSetor = new Map(setores.map((s) => [s.id, s.nome]));
  const lim = limitesAnexos({ protocolo_max_anexos: cfg?.protocolo_max_anexos, protocolo_max_mb: cfg?.protocolo_max_mb });
  return {
    portal_ativo: cfg?.protocolo_portal_ativo ?? false,
    slug: org?.slug_publico ?? null,
    url_publica: urlPortal(org?.slug_publico ?? null),
    orientacao: cfg?.protocolo_orientacao ?? null,
    max_anexos: lim.max_anexos, max_mb: lim.max_mb,
    responsavel_id: cfg?.protocolo_responsavel_id ?? null,
    assuntos: assuntos.map((a) => ({ id: a.id, nome: a.nome, descricao: a.descricao, destino_setor_id: a.destino_setor_id, destino_setor: nomeSetor.get(a.destino_setor_id) ?? null, tipo_documento_id: a.tipo_documento_id, prioridade: a.prioridade, prazo_dias: a.prazo_dias, ativo: a.ativo, ordem: a.ordem })),
    responsaveis: membros.map((m) => m.usuario).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    setores, tipos,
  };
}

export async function salvarConfigProtocolo(ctx: CtxGed, entrada: unknown): Promise<void> {
  exigirAdmin(ctx);
  const e = zConfigProtocolo.parse(entrada);
  const slug = e.slug ? normalizarSlug(e.slug) : null;
  if (slug) {
    const erro = erroSlug(slug);
    if (erro) throw invalido(erro);
    if (await slugPortalEmUso(slug, ctx.organizacao_id)) throw invalido("Este endereço já está em uso por outro órgão. Escolha outro.");
  }
  const antes = await lerConfigProtocolo(ctx);
  if (e.responsavel_id) {
    const ok = await ctx.db.gedMembro.findFirst({ where: { usuario_id: e.responsavel_id, ativo: true, papel: { in: ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"] }, usuario: { is: { ativo: true, organizacao_id: ctx.organizacao_id } } }, select: { id: true } });
    if (!ok) throw invalido("O responsável precisa ser um membro ativo com papel de Administrador, Gestor ou Usuário.");
  }
  if (e.portal_ativo) {
    if (!slug) throw invalido("Defina o endereço público do portal antes de ligar o protocolo online.");
    if (!e.responsavel_id) throw invalido("Escolha o responsável que receberá os documentos enviados pelo portal.");
    if (!antes.assuntos.some((a) => a.ativo)) throw invalido("Cadastre ao menos um assunto ativo antes de ligar o protocolo online.");
  }
  const dados = {
    protocolo_portal_ativo: e.portal_ativo, protocolo_orientacao: e.orientacao ?? null, protocolo_max_anexos: e.max_anexos, protocolo_max_mb: e.max_mb, protocolo_responsavel_id: e.responsavel_id ?? null,
  };
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.gedConfig.upsert({ where: { organizacao_id: ctx.organizacao_id }, create: dados as Prisma.GedConfigUncheckedCreateInput, update: dados });
      await tx.organizacao.update({ where: { id: ctx.organizacao_id }, data: { slug_publico: slug } });
      await auditarGed(ctx, {
        acao: "GED_PROTOCOLO_PORTAL_CONFIGURADO", entidade: "ged_config", entidade_id: ctx.organizacao_id,
        antes: { portal_ativo: antes.portal_ativo, slug: antes.slug, max_anexos: antes.max_anexos, max_mb: antes.max_mb, responsavel_id: antes.responsavel_id },
        depois: { portal_ativo: e.portal_ativo, slug, max_anexos: e.max_anexos, max_mb: e.max_mb, responsavel_id: e.responsavel_id ?? null },
      }, tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw invalido("Este endereço já está em uso por outro órgão. Escolha outro.");
    throw err;
  }
}

async function validarAssunto(ctx: CtxGed, a: z.infer<typeof zAssunto>) {
  if (a.tipo_documento_id && !(await ctx.db.gedTipoDocumento.findUnique({ where: { id: a.tipo_documento_id }, select: { id: true } }))) throw invalido("Tipo de documento não encontrado.");
  // o setor existe, está ativo e tem participante apto a receber (senão o encaminhamento do protocolo falharia)
  await resolverDestinatario(ctx.db, ctx, { usuario_id: null, setor_id: a.destino_setor_id });
}

const ehUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function criarAssunto(ctx: CtxGed, entrada: unknown): Promise<{ id: string }> {
  exigirAdmin(ctx);
  const a = zAssunto.parse(entrada);
  await validarAssunto(ctx, a);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const r = await tx.gedProtocoloAssunto.create({
        data: { nome: a.nome, descricao: a.descricao ?? null, destino_setor_id: a.destino_setor_id, tipo_documento_id: a.tipo_documento_id ?? null, prioridade: a.prioridade, prazo_dias: a.prazo_dias ?? null, ordem: a.ordem } as Prisma.GedProtocoloAssuntoUncheckedCreateInput,
        select: { id: true },
      });
      await auditarGed(ctx, { acao: "GED_PROTOCOLO_ASSUNTO_CRIADO", entidade: "ged_protocolo_assunto", entidade_id: r.id, depois: a }, tx);
      return r;
    });
  } catch (e) {
    if (ehUnico(e)) throw invalido("Já existe um assunto com este nome.");
    throw e;
  }
}

export async function atualizarAssunto(ctx: CtxGed, id: string, entrada: unknown): Promise<void> {
  exigirAdmin(ctx);
  const a = zAssunto.parse(entrada);
  await validarAssunto(ctx, a);
  try {
    await ctx.db.$transaction(async (tx) => {
      const antes = exigirEncontrado(await tx.gedProtocoloAssunto.findUnique({ where: { id } }), "Assunto não encontrado.");
      await tx.gedProtocoloAssunto.update({ where: { id }, data: { nome: a.nome, descricao: a.descricao ?? null, destino_setor_id: a.destino_setor_id, tipo_documento_id: a.tipo_documento_id ?? null, prioridade: a.prioridade, prazo_dias: a.prazo_dias ?? null, ordem: a.ordem } });
      await auditarGed(ctx, { acao: "GED_PROTOCOLO_ASSUNTO_ATUALIZADO", entidade: "ged_protocolo_assunto", entidade_id: id, antes: { nome: antes.nome, destino_setor_id: antes.destino_setor_id, prioridade: antes.prioridade, prazo_dias: antes.prazo_dias }, depois: a }, tx);
    });
  } catch (e) {
    if (ehUnico(e)) throw invalido("Já existe um assunto com este nome.");
    throw e;
  }
}

export async function definirAssuntoAtivo(ctx: CtxGed, id: string, ativo: boolean): Promise<void> {
  exigirAdmin(ctx);
  await ctx.db.$transaction(async (tx) => {
    const antes = exigirEncontrado(await tx.gedProtocoloAssunto.findUnique({ where: { id } }), "Assunto não encontrado.");
    if (antes.ativo === ativo) return;
    if (!ativo) {
      // Não deixa o portal ligado sem nenhum assunto ativo.
      const cfg = await tx.gedConfig.findFirst({ select: { protocolo_portal_ativo: true } });
      const outros = await tx.gedProtocoloAssunto.count({ where: { ativo: true, id: { not: id } } });
      if (cfg?.protocolo_portal_ativo && outros === 0) throw invalido("O protocolo online está ligado: mantenha ao menos um assunto ativo ou desligue o portal primeiro.");
    }
    await tx.gedProtocoloAssunto.update({ where: { id }, data: { ativo } });
    await auditarGed(ctx, { acao: ativo ? "GED_PROTOCOLO_ASSUNTO_ATIVADO" : "GED_PROTOCOLO_ASSUNTO_DESATIVADO", entidade: "ged_protocolo_assunto", entidade_id: id, antes: { ativo: antes.ativo }, depois: { ativo } }, tx);
  });
}

export async function excluirAssunto(ctx: CtxGed, id: string): Promise<void> {
  exigirAdmin(ctx);
  await ctx.db.$transaction(async (tx) => {
    const antes = exigirEncontrado(await tx.gedProtocoloAssunto.findUnique({ where: { id } }), "Assunto não encontrado.");
    if (antes.ativo) {
      const cfg = await tx.gedConfig.findFirst({ select: { protocolo_portal_ativo: true } });
      const outros = await tx.gedProtocoloAssunto.count({ where: { ativo: true, id: { not: id } } });
      if (cfg?.protocolo_portal_ativo && outros === 0) throw invalido("O protocolo online está ligado: mantenha ao menos um assunto ativo ou desligue o portal primeiro.");
    }
    await tx.gedProtocoloAssunto.delete({ where: { id } });
    await auditarGed(ctx, { acao: "GED_PROTOCOLO_ASSUNTO_EXCLUIDO", entidade: "ged_protocolo_assunto", entidade_id: id, antes: { nome: antes.nome, destino_setor_id: antes.destino_setor_id } }, tx);
  });
}
