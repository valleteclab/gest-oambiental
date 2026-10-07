// Gestão de ACL (permissões por pasta/documento) – docs/ged-design.md §7.
//
// Regras:
//  - Quem lista/concede/revoga precisa de ADMINISTRAR no recurso (GED_ADMIN, Gestor com ACL/posse; Usuário nunca – teto do papel).
//  - O principal (usuário/setor) precisa ser do MESMO cliente (usuário com GedMembro ativo; setor ativo).
//  - Ninguém concede além do que tem: as ações concedidas ⊆ ações efetivas de quem concede. Exceção: GED_ADMIN pode
//    conceder qualquer ação, MAS em documento SIGILOSO que ele próprio não vê (sem ACL) só pode revogar – nunca conceder
//    (senão o sigilo perante o administrador seria só aparente).
//  - Toda ACL guardada inclui VER (conceder EDITAR/ASSINAR/TRAMITAR/ADMINISTRAR/ANONIMIZAR implica visualizar).
//  - Conceder a um (recurso, principal) que já tem entrada ATUALIZA a entrada (ações e validade).
//  - Toda escrita é auditada (GED_ACL_*), com organizacao_id, na mesma transação.
import type { GedAcao, Prisma } from "@prisma/client";
import { invalido, proibido } from "@/lib/http";
import { auditarGed } from "./auditoria";
import { exigirEncontrado, naoEncontrado, type GedTx } from "./db";
import type { CtxGed } from "./escopo";
import { notificar } from "./notificar";
import { aclVigente, exigirDocumento, exigirPasta } from "./permissoes";
import { recalcularCaminhos } from "./pastas-caminho";
import { ACOES_GED, zConcederAcl, type AlvoAcl, type PrincipalAcl } from "./tipos";

export type EntradaAclView = {
  id: string;
  alvo: AlvoAcl;
  principal_tipo: "USUARIO" | "SETOR";
  usuario_id: string | null;
  setor_id: string | null;
  principal_nome: string;
  acoes: GedAcao[];
  expira_em: Date | null;
  vigente: boolean;
  concedido_por_id: string;
  concedido_por_nome: string;
  created_at: Date;
};

type Autorizacao = { acoesDoGranter: GedAcao[]; sigilosoSemVer: boolean };

/** Exige ADMINISTRAR no recurso (semântica 404/403 de permissoes.ts) e devolve o que o usuário pode repassar. */
async function autorizarAdministrar(ctx: CtxGed, alvo: AlvoAcl): Promise<Autorizacao> {
  if (alvo.tipo === "documento") {
    const { doc, acoes } = await exigirDocumento(ctx, alvo.id, "ADMINISTRAR", { semMemo: true });
    return { acoesDoGranter: acoes, sigilosoSemVer: doc.sensibilidade === "SIGILOSO" && !acoes.includes("VER") };
  }
  const { acoes } = await exigirPasta(ctx, alvo.id, "ADMINISTRAR", { semMemo: true });
  return { acoesDoGranter: acoes, sigilosoSemVer: false };
}

const normalizarAcoes = (acoes: GedAcao[]): GedAcao[] => [...new Set<GedAcao>(["VER", ...acoes])];

/** `expira_em` aceita ISO com fuso ou só data (vale até o fim do dia, horário de Brasília). */
function parseExpiracao(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999-03:00`) : new Date(v);
  if (Number.isNaN(d.getTime())) throw invalido("Data de expiração inválida.");
  if (d.getTime() <= Date.now()) throw invalido("A data de expiração deve estar no futuro.");
  return d;
}

const whereAlvo = (alvo: AlvoAcl): Prisma.GedAclWhereInput => (alvo.tipo === "pasta" ? { pasta_id: alvo.id } : { documento_id: alvo.id });

/** Valida que o principal é do mesmo cliente e devolve o nome para exibição/auditoria. */
async function validarPrincipal(ctx: CtxGed, principal: PrincipalAcl): Promise<string> {
  if (principal.tipo === "USUARIO") {
    const u = await ctx.db.usuario.findFirst({ where: { id: principal.id, organizacao_id: ctx.organizacao_id, ativo: true }, select: { nome: true } });
    if (!u) throw invalido("Usuário não encontrado nesta organização.");
    const m = await ctx.db.gedMembro.findFirst({ where: { usuario_id: principal.id, ativo: true }, select: { id: true } });
    if (!m) throw invalido("Este usuário não tem acesso ao módulo Gestão de Documentos.");
    return u.nome;
  }
  const s = await ctx.db.gedSetor.findFirst({ where: { id: principal.id, ativo: true }, select: { nome: true } });
  if (!s) throw invalido("Setor não encontrado nesta organização.");
  return s.nome;
}

/** Enquanto a frente E não substitui o esqueleto de notificar(), não derruba o fluxo. */
async function tentarNotificarCompartilhamento(tx: GedTx, ctx: CtxGed, usuarioIds: string[], documentoId: string) {
  if (!usuarioIds.length) return;
  try {
    await notificar(tx, ctx, "DOCUMENTO_COMPARTILHADO", { usuario_ids: usuarioIds, documento_id: documentoId });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "não implementado") throw e;
  }
}

// ───────────── Consulta ─────────────

export async function listarAcl(ctx: CtxGed, alvo: AlvoAcl): Promise<EntradaAclView[]> {
  await autorizarAdministrar(ctx, alvo);
  const l = await ctx.db.gedAcl.findMany({ where: whereAlvo(alvo), orderBy: { created_at: "asc" } });
  const uids = [...new Set(l.flatMap((a) => [a.usuario_id, a.concedido_por_id].filter((x): x is string => !!x)))];
  const sids = [...new Set(l.flatMap((a) => (a.setor_id ? [a.setor_id] : [])))];
  const [usuarios, setores] = await Promise.all([
    uids.length ? ctx.db.usuario.findMany({ where: { id: { in: uids }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true } }) : [],
    sids.length ? ctx.db.gedSetor.findMany({ where: { id: { in: sids } }, select: { id: true, nome: true } }) : [],
  ]);
  const un = new Map(usuarios.map((u) => [u.id, u.nome]));
  const sn = new Map(setores.map((s) => [s.id, s.nome]));
  return l.map((a) => ({
    id: a.id,
    alvo,
    principal_tipo: a.principal_tipo,
    usuario_id: a.usuario_id,
    setor_id: a.setor_id,
    principal_nome: (a.usuario_id ? un.get(a.usuario_id) : a.setor_id ? sn.get(a.setor_id) : null) ?? "(removido)",
    acoes: a.acoes,
    expira_em: a.expira_em,
    vigente: aclVigente(a),
    concedido_por_id: a.concedido_por_id,
    concedido_por_nome: un.get(a.concedido_por_id) ?? "—",
    created_at: a.created_at,
  }));
}

/** Ações que o usuário pode conceder neste recurso (para montar o formulário). Vazio = não pode conceder. */
export async function acoesConcediveis(ctx: CtxGed, alvo: AlvoAcl): Promise<GedAcao[]> {
  const aut = await autorizarAdministrar(ctx, alvo);
  if (ctx.membro.papel === "GED_ADMIN") return aut.sigilosoSemVer ? [] : [...ACOES_GED];
  return aut.acoesDoGranter;
}

/** Usuários (membros ativos) e setores do cliente, para os seletores do painel de ACL. */
export async function opcoesAcl(ctx: CtxGed) {
  const [membros, setores] = await Promise.all([
    ctx.db.gedMembro.findMany({ where: { ativo: true }, select: { papel: true, usuario: { select: { id: true, nome: true, cargo: true } } } }),
    ctx.db.gedSetor.findMany({ where: { ativo: true }, select: { id: true, nome: true, sigla: true }, orderBy: { nome: "asc" } }),
  ]);
  const usuarios = membros.map((m) => ({ id: m.usuario.id, nome: m.usuario.nome, cargo: m.usuario.cargo, papel: m.papel })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { usuarios, setores };
}

// ───────────── Escrita ─────────────

/** Concede (ou atualiza) uma permissão. `entrada` é validada com zConcederAcl (lança ZodError → 422 em rota()). */
export async function concederAcl(ctx: CtxGed, entrada: unknown): Promise<{ id: string; criada: boolean }> {
  const e = zConcederAcl.parse(entrada);
  const aut = await autorizarAdministrar(ctx, e.alvo);
  const acoes = normalizarAcoes(e.acoes);
  if (ctx.membro.papel !== "GED_ADMIN") {
    const alemDoPermitido = acoes.filter((a) => !aut.acoesDoGranter.includes(a));
    if (alemDoPermitido.length) throw proibido("Você não pode conceder permissões além das que você mesmo possui.");
  } else if (aut.sigilosoSemVer) {
    throw proibido("Documento sigiloso: somente quem tem acesso a ele pode conceder acesso a outras pessoas.");
  }
  const expira_em = parseExpiracao(e.expira_em);
  const nomePrincipal = await validarPrincipal(ctx, e.principal);
  const principalWhere: Prisma.GedAclWhereInput = e.principal.tipo === "USUARIO" ? { usuario_id: e.principal.id } : { setor_id: e.principal.id };

  return ctx.db.$transaction(async (tx) => {
    const existente = await tx.gedAcl.findFirst({ where: { AND: [whereAlvo(e.alvo), principalWhere] } });
    let id: string;
    if (existente) {
      id = existente.id;
      await tx.gedAcl.update({ where: { id }, data: { acoes, expira_em, concedido_por_id: ctx.usuario.id } });
    } else {
      const c = await tx.gedAcl.create({
        data: {
          pasta_id: e.alvo.tipo === "pasta" ? e.alvo.id : null,
          documento_id: e.alvo.tipo === "documento" ? e.alvo.id : null,
          principal_tipo: e.principal.tipo,
          usuario_id: e.principal.tipo === "USUARIO" ? e.principal.id : null,
          setor_id: e.principal.tipo === "SETOR" ? e.principal.id : null,
          acoes,
          expira_em,
          concedido_por_id: ctx.usuario.id,
        } as Prisma.GedAclUncheckedCreateInput,
      });
      id = c.id;
    }
    await auditarGed(
      ctx,
      {
        acao: existente ? "GED_ACL_ATUALIZADA" : "GED_ACL_CONCEDIDA",
        entidade: "ged_acl",
        entidade_id: id,
        antes: existente ? { acoes: existente.acoes, expira_em: existente.expira_em } : undefined,
        depois: { alvo: e.alvo, principal: { ...e.principal, nome: nomePrincipal }, acoes, expira_em },
      },
      tx,
    );
    if (e.alvo.tipo === "documento") {
      const destinatarios =
        e.principal.tipo === "USUARIO"
          ? [e.principal.id]
          : (await tx.gedSetorMembro.findMany({ where: { setor_id: e.principal.id }, select: { usuario_id: true } })).map((m) => m.usuario_id);
      await tentarNotificarCompartilhamento(tx, ctx, destinatarios.filter((u) => u !== ctx.usuario.id), e.alvo.id);
    }
    return { id, criada: !existente };
  });
}

/** Revoga uma entrada de ACL (exige ADMINISTRAR no recurso). Outro cliente/inexistente → 404. */
export async function revogarAcl(ctx: CtxGed, aclId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(aclId)) throw naoEncontrado("Permissão não encontrada.");
  const acl = exigirEncontrado(await ctx.db.gedAcl.findUnique({ where: { id: aclId } }), "Permissão não encontrada.");
  const alvo: AlvoAcl = acl.documento_id ? { tipo: "documento", id: acl.documento_id } : { tipo: "pasta", id: acl.pasta_id! };
  await autorizarAdministrar(ctx, alvo);
  await ctx.db.$transaction(async (tx) => {
    await tx.gedAcl.delete({ where: { id: aclId } });
    await auditarGed(ctx, { acao: "GED_ACL_REVOGADA", entidade: "ged_acl", entidade_id: aclId, antes: { alvo, principal_tipo: acl.principal_tipo, usuario_id: acl.usuario_id, setor_id: acl.setor_id, acoes: acl.acoes, expira_em: acl.expira_em } }, tx);
  });
}

/**
 * ACL inicial do criador de uma pasta/documento (ex.: Gestor que cria pasta passa a administrá-la). Sem checagem de
 * ADMINISTRAR (o chamador acabou de criar o recurso); chame na transação da criação.
 */
export async function concederAclAoCriador(tx: GedTx, ctx: CtxGed, alvo: AlvoAcl, acoes: GedAcao[] = ["VER", "EDITAR", "ADMINISTRAR"]) {
  const c = await tx.gedAcl.create({
    data: {
      pasta_id: alvo.tipo === "pasta" ? alvo.id : null,
      documento_id: alvo.tipo === "documento" ? alvo.id : null,
      principal_tipo: "USUARIO",
      usuario_id: ctx.usuario.id,
      acoes: normalizarAcoes(acoes),
      concedido_por_id: ctx.usuario.id,
    } as Prisma.GedAclUncheckedCreateInput,
  });
  await auditarGed(ctx, { acao: "GED_ACL_CONCEDIDA", entidade: "ged_acl", entidade_id: c.id, depois: { alvo, principal: { tipo: "USUARIO", id: ctx.usuario.id }, acoes: c.acoes, origem: "criador" } }, tx);
  return c.id;
}

// ───────────── Herança ─────────────

/** Liga/desliga a herança de ACL da pasta (herda_acl) e recalcula caminho_heranca dela e das descendentes. */
export async function definirHerancaPasta(ctx: CtxGed, pastaId: string, herda: boolean): Promise<void> {
  await exigirPasta(ctx, pastaId, "ADMINISTRAR", { semMemo: true });
  await ctx.db.$transaction(async (tx) => {
    const antes = exigirEncontrado(await tx.gedPasta.findUnique({ where: { id: pastaId }, select: { herda_acl: true } }), "Pasta não encontrada.");
    if (antes.herda_acl === herda) return;
    await tx.gedPasta.update({ where: { id: pastaId }, data: { herda_acl: herda } });
    await recalcularCaminhos(tx, pastaId);
    await auditarGed(ctx, { acao: "GED_PASTA_HERANCA_ALTERADA", entidade: "ged_pasta", entidade_id: pastaId, antes: { herda_acl: antes.herda_acl }, depois: { herda_acl: herda } }, tx);
  });
}

/** `acl_propria=true`: o documento deixa de herdar a ACL da pasta (só ACL direta/posse/trâmite/assinatura). */
export async function definirAclPropriaDocumento(ctx: CtxGed, documentoId: string, aclPropria: boolean): Promise<void> {
  await exigirDocumento(ctx, documentoId, "ADMINISTRAR", { semMemo: true });
  await ctx.db.$transaction(async (tx) => {
    const antes = exigirEncontrado(await tx.gedDocumento.findUnique({ where: { id: documentoId }, select: { acl_propria: true } }), "Documento não encontrado.");
    if (antes.acl_propria === aclPropria) return;
    await tx.gedDocumento.update({ where: { id: documentoId }, data: { acl_propria: aclPropria } });
    await auditarGed(ctx, { acao: "GED_DOCUMENTO_ACL_PROPRIA", entidade: "ged_documento", entidade_id: documentoId, antes: { acl_propria: antes.acl_propria }, depois: { acl_propria: aclPropria } }, tx);
  });
}
