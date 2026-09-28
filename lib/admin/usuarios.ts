import "server-only";
import type { Papel, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { hashSenha } from "@/lib/auth";
import { cifrar, hashBusca, somenteDigitos, validarCPF } from "@/lib/crypto";
import { invalido, naoEncontrado } from "@/lib/http";
import { PAPEIS_ORGANIZACAO, type UsuarioSessao } from "@/lib/rbac";
import { gerarSenhaTemporaria } from "./senha";
import { exigirMunicipioDoAdmin, organizacaoDoAdmin, whereUsuariosAdmin } from "./escopo";

// Gestão de usuários e papéis (SPEC 4.2/4.3): nunca deletar usuário; senha temporária + troca obrigatória.

export const PAPEIS: Papel[] = ["ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL", "FISCAL", "SEMA_INEMA", "REQUERENTE"];
/** Papéis com escopo organização (municipio_id NULL). Os demais exigem município. */
export const PAPEIS_SEM_MUNICIPIO: Papel[] = [...PAPEIS_ORGANIZACAO, "REQUERENTE"];

const SELECAO = { id: true, nome: true, email: true, cargo: true, ativo: true, trocar_senha: true, ultimo_login: true, bloqueado_ate: true, pessoa_id: true, organizacao_id: true, created_at: true, papeis: { select: { id: true, papel: true, municipio_id: true, municipio: { select: { nome: true, sigla: true } } } } } satisfies Prisma.UsuarioSelect;

export const NovoUsuarioSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome."),
  email: z.email("E-mail inválido.").trim().toLowerCase(),
  cargo: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  cpf: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null)).refine((v) => v === null || validarCPF(v), "CPF inválido."),
  papel: z.enum(PAPEIS as [Papel, ...Papel[]]).optional().nullable(),
  municipio_id: z.preprocess((v) => (v === "" ? null : v), z.uuid().optional().nullable()),
});

export const EdicaoUsuarioSchema = z.object({
  nome: z.string().trim().min(3).optional(),
  email: z.email().trim().toLowerCase().optional(),
  cargo: z.string().trim().max(120).optional().nullable(),
  ativo: z.boolean().optional(),
});

/** Usuários da organização do admin (isolamento por cliente) com filtros. */
export async function listarUsuarios(admin: UsuarioSessao, f: { q?: string | null; papel?: string | null; municipio_id?: string | null; ativo?: boolean | null; skip?: number; take?: number }) {
  const where: Prisma.UsuarioWhereInput = {
    AND: [
      whereUsuariosAdmin(admin),
      f.q ? { OR: [{ nome: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }] } : {},
      f.papel && (PAPEIS as string[]).includes(f.papel) ? { papeis: { some: { papel: f.papel as Papel } } } : {},
      f.municipio_id ? { papeis: { some: { municipio_id: f.municipio_id } } } : {},
      f.ativo === null || f.ativo === undefined ? {} : { ativo: f.ativo },
    ],
  };
  const [total, itens] = await Promise.all([prisma.usuario.count({ where }), prisma.usuario.findMany({ where, select: SELECAO, orderBy: { nome: "asc" }, skip: f.skip ?? 0, take: f.take ?? 30 })]);
  return { total, itens };
}

/** Usuário visível ao admin (null = inexistente OU de outra organização – não revela a existência). */
export async function obterUsuarioAdmin(admin: UsuarioSessao, id: string) {
  return prisma.usuario.findFirst({ where: { AND: [{ id }, whereUsuariosAdmin(admin)] }, select: SELECAO }).catch(() => null);
}

/** Exige que o usuário-alvo seja administrável pelo admin (404 caso contrário). */
async function exigirVisivel(admin: UsuarioSessao, id: string) {
  const u = await obterUsuarioAdmin(admin, id);
  if (!u) throw naoEncontrado("Usuário não encontrado.");
  return u;
}

function validarPapel(papel: Papel, municipioId: string | null) {
  if (PAPEIS_SEM_MUNICIPIO.includes(papel) && municipioId) throw invalido(`O papel ${papel} tem escopo de organização – não informe município.`, { campo: "municipio_id" });
  if (!PAPEIS_SEM_MUNICIPIO.includes(papel) && !municipioId) throw invalido(`O papel ${papel} exige um município.`, { campo: "municipio_id" });
}

/** Cria usuário com senha temporária (retornada UMA vez) e trocar_senha = true. */
export async function criarUsuario(admin: UsuarioSessao, entrada: unknown) {
  const e = NovoUsuarioSchema.parse(entrada);
  if (await prisma.usuario.findUnique({ where: { email: e.email } })) throw invalido("Já existe usuário com este e-mail.", { campo: "email" });
  if (e.cpf && (await prisma.usuario.findUnique({ where: { cpf_hash: hashBusca(e.cpf) } }))) throw invalido("Já existe usuário com este CPF.", { campo: "cpf" });
  if (e.papel) validarPapel(e.papel, e.municipio_id ?? null);
  const organizacao_id = organizacaoDoAdmin(admin);
  await exigirMunicipioDoAdmin(admin, e.municipio_id);
  const senha = gerarSenhaTemporaria();
  const senha_hash = await hashSenha(senha);
  const u = await prisma.$transaction(async (tx) => {
    const u = await tx.usuario.create({
      data: { organizacao_id, nome: e.nome, email: e.email, cargo: e.cargo, cpf_cifrado: e.cpf ? cifrar(e.cpf) : null, cpf_hash: e.cpf ? hashBusca(e.cpf) : null, senha_hash, trocar_senha: true, created_by: admin.id },
    });
    if (e.papel) await tx.usuarioPapel.create({ data: { usuario_id: u.id, papel: e.papel, municipio_id: e.municipio_id ?? null, created_by: admin.id } });
    await auditar({ usuario_id: admin.id, acao: "CRIAR", entidade: "usuario", entidade_id: u.id, depois: { nome: u.nome, email: u.email, cargo: u.cargo, papel: e.papel ?? null, municipio_id: e.municipio_id ?? null } }, tx);
    return u;
  });
  return { usuario: u, senhaTemporaria: senha };
}

export async function editarUsuario(admin: UsuarioSessao, id: string, entrada: unknown) {
  const e = EdicaoUsuarioSchema.parse(entrada);
  await exigirVisivel(admin, id);
  const atual = await prisma.usuario.findUnique({ where: { id } });
  if (!atual) throw naoEncontrado("Usuário não encontrado.");
  if (e.ativo === false && id === admin.id) throw invalido("Você não pode desativar o próprio usuário.");
  if (e.email && e.email !== atual.email && (await prisma.usuario.findUnique({ where: { email: e.email } }))) throw invalido("Já existe usuário com este e-mail.", { campo: "email" });
  return prisma.$transaction(async (tx) => {
    const u = await tx.usuario.update({ where: { id }, data: { ...e, cargo: e.cargo === undefined ? undefined : e.cargo || null } });
    const acao = e.ativo === false && atual.ativo ? "DESATIVAR" : e.ativo === true && !atual.ativo ? "ATIVAR" : "EDITAR";
    await auditar({ usuario_id: admin.id, acao, entidade: "usuario", entidade_id: id, antes: { nome: atual.nome, email: atual.email, cargo: atual.cargo, ativo: atual.ativo }, depois: { nome: u.nome, email: u.email, cargo: u.cargo, ativo: u.ativo } }, tx);
    return u;
  });
}

export async function adicionarPapel(admin: UsuarioSessao, usuarioId: string, papel: Papel, municipioId: string | null) {
  if (!PAPEIS.includes(papel)) throw invalido("Papel inválido.", { campo: "papel" });
  validarPapel(papel, municipioId);
  const alvo = await exigirVisivel(admin, usuarioId);
  const org = organizacaoDoAdmin(admin);
  if (municipioId && !(await prisma.municipio.count({ where: { id: municipioId, organizacao_id: org } }))) throw invalido("Município inválido.", { campo: "municipio_id" });
  // Papel interno em requerente sem organização: o usuário passa a pertencer à organização do admin.
  const vincularOrganizacao = papel !== "REQUERENTE" && !alvo.organizacao_id;
  if (await prisma.usuarioPapel.findFirst({ where: { usuario_id: usuarioId, papel, municipio_id: municipioId } })) throw invalido("O usuário já possui este papel neste escopo.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.usuarioPapel.create({ data: { usuario_id: usuarioId, papel, municipio_id: municipioId, created_by: admin.id } });
    if (vincularOrganizacao) await tx.usuario.update({ where: { id: usuarioId }, data: { organizacao_id: org } });
    await auditar({ usuario_id: admin.id, acao: "ADICIONAR_PAPEL", entidade: "usuario", entidade_id: usuarioId, depois: { papel, municipio_id: municipioId } }, tx);
    return p;
  });
}

export async function removerPapel(admin: UsuarioSessao, usuarioId: string, papelId: string) {
  await exigirVisivel(admin, usuarioId);
  const p = await prisma.usuarioPapel.findFirst({ where: { id: papelId, usuario_id: usuarioId } });
  if (!p) throw naoEncontrado("Vínculo não encontrado.");
  if (usuarioId === admin.id && p.papel === "ADMIN") {
    const outros = await prisma.usuarioPapel.count({ where: { usuario_id: admin.id, papel: "ADMIN", id: { not: p.id } } });
    if (!outros) throw invalido("Você não pode remover o próprio papel de administrador.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.usuarioPapel.delete({ where: { id: p.id } });
    await auditar({ usuario_id: admin.id, acao: "REMOVER_PAPEL", entidade: "usuario", entidade_id: usuarioId, antes: { papel: p.papel, municipio_id: p.municipio_id } }, tx);
  });
}

/** Gera nova senha temporária, força troca no próximo acesso e desbloqueia a conta. */
export async function redefinirSenha(admin: UsuarioSessao, usuarioId: string) {
  await exigirVisivel(admin, usuarioId);
  const senha = gerarSenhaTemporaria();
  const senha_hash = await hashSenha(senha);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: usuarioId }, data: { senha_hash, trocar_senha: true, falhas_login: 0, bloqueado_ate: null } });
    await auditar({ usuario_id: admin.id, acao: "REDEFINIR_SENHA", entidade: "usuario", entidade_id: usuarioId }, tx);
  });
  return senha;
}
