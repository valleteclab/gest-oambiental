// Administração de membros do GED (somente GED_ADMIN): criar/ativar/desativar, papel, setores e senha provisória.
// Criar membro = Usuario DESTA organização + GedMembro. E-mail é único na plataforma: usuário de OUTRA organização ou requerente
// nunca é reaproveitado (erro amigável). Tudo auditado; o último GED_ADMIN ativo não pode ser removido/rebaixado.
import { Prisma, type GedPapel } from "@prisma/client";
import { hashSenha } from "@/lib/auth";
import { invalido, proibido } from "@/lib/http";
import { gerarSenhaTemporaria } from "@/lib/admin/senha";
import { auditarGed } from "../auditoria";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { podeAdministrarGed } from "../papeis";
import { definirMembroSetor, removerMembroSetor } from "../setores";
import { mascararEmail } from "../notificar/regras";
import { zPapelGed, zUuid } from "../tipos";
import { classificarEmail, manteraAdminAtivo, MENSAGEM_EMAIL, podeRedefinirSenha, zNovoMembro } from "./regras";

export function exigirAdmin(ctx: CtxGed) {
  if (!podeAdministrarGed(ctx)) throw proibido("Somente o administrador do módulo pode fazer isto.");
}

export type MembroView = {
  id: string;
  usuario_id: string;
  nome: string;
  email: string;
  cargo: string | null;
  papel: GedPapel;
  ativo: boolean;
  trocar_senha: boolean;
  ultimo_login: Date | null;
  whatsapp_confirmado: boolean;
  tambem_licenciamento: boolean;
  setores: { id: string; sigla: string; nome: string; chefe: boolean }[];
};

export async function listarMembros(ctx: CtxGed): Promise<MembroView[]> {
  exigirAdmin(ctx);
  const [ms, sm] = await Promise.all([
    ctx.db.gedMembro.findMany({
      select: {
        id: true, usuario_id: true, papel: true, ativo: true, whatsapp_optin_em: true,
        usuario: { select: { nome: true, email: true, cargo: true, trocar_senha: true, ultimo_login: true, papeis: { select: { id: true }, take: 1 } } },
      },
    }),
    ctx.db.gedSetorMembro.findMany({ where: { setor: { ativo: true } }, select: { usuario_id: true, chefe: true, setor: { select: { id: true, sigla: true, nome: true } } } }),
  ]);
  return ms
    .map((m): MembroView => ({
      id: m.id, usuario_id: m.usuario_id, nome: m.usuario.nome, email: m.usuario.email, cargo: m.usuario.cargo, papel: m.papel, ativo: m.ativo,
      trocar_senha: m.usuario.trocar_senha, ultimo_login: m.usuario.ultimo_login, whatsapp_confirmado: !!m.whatsapp_optin_em, tambem_licenciamento: m.usuario.papeis.length > 0,
      setores: sm.filter((s) => s.usuario_id === m.usuario_id).map((s) => ({ ...s.setor, chefe: s.chefe })).sort((a, b) => a.sigla.localeCompare(b.sigla)),
    }))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
}

const concorrente = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2034" || e.code === "P2002");

/** Valida a regra do último administrador dentro de uma transação serializável e aplica `aplicar`. */
async function comRegraDoAdmin<T>(ctx: CtxGed, alvoId: string, mudanca: { papel?: GedPapel; ativo?: boolean }, aplicar: (tx: Parameters<Parameters<CtxGed["db"]["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  try {
    return await ctx.db.$transaction(
      async (tx) => {
        const todos = await tx.gedMembro.findMany({ select: { id: true, papel: true, ativo: true } });
        if (!manteraAdminAtivo(todos, alvoId, mudanca)) throw invalido("O cliente precisa ter ao menos um administrador ativo. Promova outra pessoa antes de rebaixar ou desativar este administrador.");
        return aplicar(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (concorrente(e)) throw invalido("A operação conflitou com outra alteração simultânea. Tente novamente.");
    throw e;
  }
}

export async function criarMembro(ctx: CtxGed, entrada: unknown): Promise<{ membro_id: string; usuario_id: string; senha_temporaria: string | null; reaproveitou_usuario: boolean }> {
  exigirAdmin(ctx);
  const e = zNovoMembro.parse(entrada);
  const existente = await ctx.db.usuario.findUnique({ where: { email: e.email }, select: { id: true, organizacao_id: true, ativo: true } });
  const membroExistente = existente?.organizacao_id === ctx.organizacao_id ? await ctx.db.gedMembro.findFirst({ where: { usuario_id: existente.id }, select: { ativo: true } }) : null;
  const situacao = classificarEmail(existente, ctx.organizacao_id, membroExistente);
  if (situacao !== "NOVO" && situacao !== "ADICIONAR_AO_GED") throw invalido(MENSAGEM_EMAIL[situacao], { campo: "email" });
  if (situacao === "ADICIONAR_AO_GED" && !existente?.ativo) throw invalido("Este usuário está inativo na plataforma. Reative-o antes (administrador do licenciamento).", { campo: "email" });

  const senha = situacao === "NOVO" ? gerarSenhaTemporaria() : null;
  const senha_hash = senha ? await hashSenha(senha) : null;
  let r: { membro_id: string; usuario_id: string };
  try {
    r = await ctx.db.$transaction(async (tx) => {
      const usuarioId = existente
        ? existente.id
        : (await tx.usuario.create({ data: { organizacao_id: ctx.organizacao_id, nome: e.nome, email: e.email, cargo: e.cargo, senha_hash: senha_hash!, trocar_senha: true, created_by: ctx.usuario.id }, select: { id: true } })).id;
      const m = await tx.gedMembro.create({ data: { usuario_id: usuarioId, papel: e.papel, ativo: true } as Prisma.GedMembroUncheckedCreateInput, select: { id: true } });
      await auditarGed(ctx, {
        acao: "GED_MEMBRO_CRIADO", entidade: "ged_membro", entidade_id: m.id,
        depois: { usuario_id: usuarioId, nome: e.nome, email_mascarado: mascararEmail(e.email), papel: e.papel, usuario_novo: !existente },
      }, tx);
      return { membro_id: m.id, usuario_id: usuarioId };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw invalido("Já existe um usuário com este e-mail.", { campo: "email" });
    throw err;
  }
  for (const setorId of e.setor_ids) await definirMembroSetor(ctx, setorId, r.usuario_id, false);
  return { ...r, senha_temporaria: senha, reaproveitou_usuario: !!existente };
}

export async function alterarPapelMembro(ctx: CtxGed, membroId: string, papel: unknown): Promise<void> {
  exigirAdmin(ctx);
  const id = zUuid.parse(membroId);
  const novo = zPapelGed.parse(papel);
  const m = exigirEncontrado(await ctx.db.gedMembro.findUnique({ where: { id }, select: { id: true, papel: true, usuario_id: true } }), "Membro não encontrado.");
  if (m.papel === novo) return;
  await comRegraDoAdmin(ctx, id, { papel: novo }, async (tx) => {
    await tx.gedMembro.update({ where: { id }, data: { papel: novo } });
    await auditarGed(ctx, { acao: "GED_MEMBRO_PAPEL_ALTERADO", entidade: "ged_membro", entidade_id: id, antes: { papel: m.papel }, depois: { papel: novo, usuario_id: m.usuario_id } }, tx);
  });
}

export async function definirMembroAtivo(ctx: CtxGed, membroId: string, ativo: boolean): Promise<void> {
  exigirAdmin(ctx);
  const id = zUuid.parse(membroId);
  const m = exigirEncontrado(await ctx.db.gedMembro.findUnique({ where: { id }, select: { id: true, ativo: true, usuario_id: true } }), "Membro não encontrado.");
  if (m.ativo === ativo) return;
  if (!ativo && m.usuario_id === ctx.usuario.id) throw invalido("Você não pode desativar o seu próprio acesso.");
  await comRegraDoAdmin(ctx, id, { ativo }, async (tx) => {
    await tx.gedMembro.update({ where: { id }, data: { ativo } });
    await auditarGed(ctx, { acao: ativo ? "GED_MEMBRO_ATIVADO" : "GED_MEMBRO_DESATIVADO", entidade: "ged_membro", entidade_id: id, antes: { ativo: m.ativo }, depois: { ativo, usuario_id: m.usuario_id } }, tx);
  });
}

/** Ajusta os setores do membro ao conjunto informado (usa a API de setores da frente A: valida e audita cada mudança). */
export async function definirSetoresDoMembro(ctx: CtxGed, membroId: string, setorIds: string[]): Promise<void> {
  exigirAdmin(ctx);
  const m = exigirEncontrado(await ctx.db.gedMembro.findUnique({ where: { id: zUuid.parse(membroId) }, select: { usuario_id: true, ativo: true } }), "Membro não encontrado.");
  if (!m.ativo) throw invalido("Reative o membro antes de alterar os setores.");
  const alvo = new Set(setorIds.map((s) => zUuid.parse(s)));
  const atuais = await ctx.db.gedSetorMembro.findMany({ where: { usuario_id: m.usuario_id }, select: { setor_id: true, chefe: true } });
  const tem = new Map(atuais.map((a) => [a.setor_id, a.chefe]));
  for (const s of alvo) if (!tem.has(s)) await definirMembroSetor(ctx, s, m.usuario_id, false);
  for (const [s] of tem) if (!alvo.has(s)) await removerMembroSetor(ctx, s, m.usuario_id);
}

/** Nova senha provisória (mostrada UMA vez; troca obrigatória no próximo acesso). Só para quem não usa o licenciamento. */
export async function redefinirSenhaMembro(ctx: CtxGed, membroId: string): Promise<string> {
  exigirAdmin(ctx);
  const m = exigirEncontrado(
    await ctx.db.gedMembro.findUnique({ where: { id: zUuid.parse(membroId) }, select: { id: true, usuario_id: true, usuario: { select: { organizacao_id: true, papeis: { select: { id: true }, take: 1 } } } } }),
    "Membro não encontrado.",
  );
  if (m.usuario.organizacao_id !== ctx.organizacao_id) throw exigirEncontrado(null, "Membro não encontrado.");
  const ok = podeRedefinirSenha({ papeis_licenciamento: m.usuario.papeis.length, usuario_id: m.usuario_id }, ctx.usuario.id);
  if (!ok.ok) throw invalido(ok.motivo);
  const senha = gerarSenhaTemporaria();
  const senha_hash = await hashSenha(senha);
  await ctx.db.$transaction(async (tx) => {
    await tx.usuario.updateMany({ where: { id: m.usuario_id, organizacao_id: ctx.organizacao_id }, data: { senha_hash, trocar_senha: true, falhas_login: 0, bloqueado_ate: null } });
    await auditarGed(ctx, { acao: "GED_MEMBRO_SENHA_REDEFINIDA", entidade: "ged_membro", entidade_id: m.id, depois: { usuario_id: m.usuario_id } }, tx);
  });
  return senha;
}
