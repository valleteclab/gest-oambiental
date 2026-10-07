// Setores do cliente (GedSetor) e seus participantes (GedSetorMembro). Somente GED_ADMIN e GED_GESTOR escrevem.
// Setor não é excluído (pode estar em ACL/trâmite): "desativar" o tira das permissões (ctx.setor_ids só tem setores ativos).
import { invalido, proibido } from "@/lib/http";
import { auditarGed } from "./auditoria";
import { exigirEncontrado } from "./db";
import type { CtxGed } from "./escopo";
import { podeGerirEstruturaGed } from "./papeis";
import { zSetor, zUuid } from "./tipos";
import { Prisma } from "@prisma/client";

function exigirGestao(ctx: CtxGed) {
  if (!podeGerirEstruturaGed(ctx)) throw proibido("Somente administradores e gestores podem gerenciar setores.");
}

const ehUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export type SetorView = {
  id: string;
  nome: string;
  sigla: string;
  ativo: boolean;
  membros: { usuario_id: string; nome: string; cargo: string | null; chefe: boolean }[];
};

/** Todos os setores do cliente com participantes (qualquer membro do GED pode listar; escrita é restrita). */
export async function listarSetores(ctx: CtxGed, opc: { incluirInativos?: boolean } = {}): Promise<SetorView[]> {
  const l = await ctx.db.gedSetor.findMany({
    where: opc.incluirInativos ? {} : { ativo: true },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    select: { id: true, nome: true, sigla: true, ativo: true, membros: { select: { usuario_id: true, chefe: true, usuario: { select: { nome: true, cargo: true } } } } },
  });
  return l.map((s) => ({
    id: s.id, nome: s.nome, sigla: s.sigla, ativo: s.ativo,
    membros: s.membros.map((m) => ({ usuario_id: m.usuario_id, nome: m.usuario.nome, cargo: m.usuario.cargo, chefe: m.chefe })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  }));
}

export async function criarSetor(ctx: CtxGed, entrada: unknown) {
  exigirGestao(ctx);
  const e = zSetor.parse(entrada);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const s = await tx.gedSetor.create({ data: { nome: e.nome, sigla: e.sigla } as Prisma.GedSetorUncheckedCreateInput });
      await auditarGed(ctx, { acao: "GED_SETOR_CRIADO", entidade: "ged_setor", entidade_id: s.id, depois: { nome: s.nome, sigla: s.sigla } }, tx);
      return { id: s.id };
    });
  } catch (err) {
    if (ehUnico(err)) throw invalido(`Já existe um setor com a sigla ${e.sigla}.`);
    throw err;
  }
}

export async function atualizarSetor(ctx: CtxGed, setorId: string, entrada: unknown) {
  exigirGestao(ctx);
  const id = zUuid.parse(setorId);
  const e = zSetor.parse(entrada);
  const antes = exigirEncontrado(await ctx.db.gedSetor.findUnique({ where: { id } }), "Setor não encontrado.");
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.gedSetor.update({ where: { id }, data: { nome: e.nome, sigla: e.sigla } });
      await auditarGed(ctx, { acao: "GED_SETOR_ATUALIZADO", entidade: "ged_setor", entidade_id: id, antes: { nome: antes.nome, sigla: antes.sigla }, depois: e }, tx);
    });
  } catch (err) {
    if (ehUnico(err)) throw invalido(`Já existe um setor com a sigla ${e.sigla}.`);
    throw err;
  }
}

/** Ativa/desativa (sem exclusão física). Setor inativo deixa de conceder permissões e de aparecer nos seletores. */
export async function definirSetorAtivo(ctx: CtxGed, setorId: string, ativo: boolean) {
  exigirGestao(ctx);
  const id = zUuid.parse(setorId);
  const antes = exigirEncontrado(await ctx.db.gedSetor.findUnique({ where: { id } }), "Setor não encontrado.");
  if (antes.ativo === ativo) return;
  await ctx.db.$transaction(async (tx) => {
    await tx.gedSetor.update({ where: { id }, data: { ativo } });
    await auditarGed(ctx, { acao: ativo ? "GED_SETOR_ATIVADO" : "GED_SETOR_DESATIVADO", entidade: "ged_setor", entidade_id: id, antes: { ativo: antes.ativo }, depois: { ativo } }, tx);
  });
}

/** Inclui (ou altera o "chefe" de) um participante. O usuário deve ser membro ativo do GED do MESMO cliente. */
export async function definirMembroSetor(ctx: CtxGed, setorId: string, usuarioId: string, chefe = false) {
  exigirGestao(ctx);
  const sid = zUuid.parse(setorId);
  const uid = zUuid.parse(usuarioId);
  const setor = exigirEncontrado(await ctx.db.gedSetor.findUnique({ where: { id: sid } }), "Setor não encontrado.");
  const u = await ctx.db.usuario.findFirst({ where: { id: uid, organizacao_id: ctx.organizacao_id, ativo: true }, select: { nome: true } });
  if (!u || !(await ctx.db.gedMembro.findFirst({ where: { usuario_id: uid, ativo: true }, select: { id: true } }))) {
    throw invalido("Usuário não encontrado entre os membros desta organização.");
  }
  await ctx.db.$transaction(async (tx) => {
    const ex = await tx.gedSetorMembro.findFirst({ where: { setor_id: sid, usuario_id: uid } });
    if (ex) {
      if (ex.chefe === chefe) return;
      await tx.gedSetorMembro.update({ where: { id: ex.id }, data: { chefe } });
    } else {
      await tx.gedSetorMembro.create({ data: { setor_id: sid, usuario_id: uid, chefe } as Prisma.GedSetorMembroUncheckedCreateInput });
    }
    await auditarGed(ctx, { acao: ex ? "GED_SETOR_MEMBRO_ALTERADO" : "GED_SETOR_MEMBRO_ADICIONADO", entidade: "ged_setor_membro", entidade_id: ex?.id ?? null, antes: ex ? { chefe: ex.chefe } : undefined, depois: { setor_id: sid, setor: setor.sigla, usuario_id: uid, usuario: u.nome, chefe } }, tx);
  });
}

export async function removerMembroSetor(ctx: CtxGed, setorId: string, usuarioId: string) {
  exigirGestao(ctx);
  const sid = zUuid.parse(setorId);
  const uid = zUuid.parse(usuarioId);
  const ex = exigirEncontrado(await ctx.db.gedSetorMembro.findFirst({ where: { setor_id: sid, usuario_id: uid } }), "Participante não encontrado.");
  await ctx.db.$transaction(async (tx) => {
    await tx.gedSetorMembro.delete({ where: { id: ex.id } });
    await auditarGed(ctx, { acao: "GED_SETOR_MEMBRO_REMOVIDO", entidade: "ged_setor_membro", entidade_id: ex.id, antes: { setor_id: sid, usuario_id: uid, chefe: ex.chefe } }, tx);
  });
}
