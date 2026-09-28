import "server-only";
import type { Pessoa, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { cifrar, decifrar, formatarCpfCnpj, hashBusca, mascararCpfCnpj, somenteDigitos } from "@/lib/crypto";
import { invalido, naoEncontrado, proibido } from "@/lib/http";
import { can, isInterno, temEscopoOrganizacao, type UsuarioSessao } from "@/lib/rbac";
import { wherePessoaEscopo } from "./escopo";
import { PessoaSchema, type PessoaEntrada } from "./validacao";

// Serviço de Pessoas (PF/PJ) – SPEC 5.2 / 9.3 (dados pessoais cifrados, busca por hash).

/** Campos seguros para listagem/auditoria (sem dado pessoal em claro). */
export const SELECAO_PESSOA_PUBLICA = {
  id: true, tipo: true, nome: true, nome_fantasia: true, cpf_cnpj_mascara: true, municipio_id: true, created_at: true, updated_at: true,
} satisfies Prisma.PessoaSelect;

export type PessoaDecifrada = Omit<Pessoa, "cpf_cnpj_cifrado" | "cpf_cnpj_hash"> & { cpf_cnpj: string | null; cpf_cnpj_formatado: string };

/** Pode ver dados pessoais em claro? Somente interno com 'ver pessoa' no município da pessoa (ou org). */
export function podeVerDadosPessoais(u: UsuarioSessao, p: Pick<Pessoa, "municipio_id">): boolean {
  if (!isInterno(u)) return false;
  if (!can(u, "ver", "pessoa")) return false;
  return !p.municipio_id || can(u, "ver", "pessoa", p.municipio_id);
}

function semSegredos(p: Pessoa): Omit<Pessoa, "cpf_cnpj_cifrado" | "cpf_cnpj_hash"> {
  const r: Partial<Pessoa> = { ...p };
  delete r.cpf_cnpj_cifrado;
  delete r.cpf_cnpj_hash;
  return r as Omit<Pessoa, "cpf_cnpj_cifrado" | "cpf_cnpj_hash">;
}

export function decifrarPessoa(p: Pessoa): PessoaDecifrada {
  const doc = decifrar(p.cpf_cnpj_cifrado);
  const resto = semSegredos(p);
  return {
    ...resto,
    email: p.tipo === "PF" ? decifrar(p.email) : p.email,
    telefone: p.tipo === "PF" ? decifrar(p.telefone) : p.telefone,
    cpf_cnpj: doc,
    cpf_cnpj_formatado: doc ? formatarCpfCnpj(doc) : p.cpf_cnpj_mascara,
  };
}

/** Versão mascarada para quem não pode ver os dados pessoais. */
export function mascararPessoa(p: Pessoa): PessoaDecifrada {
  const resto = semSegredos(p);
  return { ...resto, email: p.tipo === "PF" ? null : p.email, telefone: p.tipo === "PF" ? null : p.telefone, cpf_cnpj: null, cpf_cnpj_formatado: p.cpf_cnpj_mascara };
}

export async function podeVerPessoa(u: UsuarioSessao, id: string): Promise<boolean> {
  return (await prisma.pessoa.count({ where: { AND: [{ id }, wherePessoaEscopo(u)] } })) > 0;
}

/** Carrega pessoa respeitando escopo: null = não existe; "PROIBIDO" = fora do escopo. */
export async function obterPessoa(u: UsuarioSessao, id: string): Promise<{ pessoa: Pessoa; dados: PessoaDecifrada; emClaro: boolean } | null | "PROIBIDO"> {
  const p = await prisma.pessoa.findUnique({ where: { id } }).catch(() => null);
  if (!p) return null;
  if (!(await podeVerPessoa(u, id))) return "PROIBIDO";
  const emClaro = podeVerDadosPessoais(u, p) || (!isInterno(u) && u.pessoa_id === p.id);
  return { pessoa: p, dados: emClaro ? decifrarPessoa(p) : mascararPessoa(p), emClaro };
}

export type FiltroPessoas = { q?: string | null; tipo?: "PF" | "PJ" | null; skip?: number; take?: number };

/** Lista com busca por nome/fantasia ou por CPF/CNPJ completo (via hash). */
export async function listarPessoas(u: UsuarioSessao, f: FiltroPessoas) {
  const q = (f.q ?? "").trim();
  const digitos = somenteDigitos(q);
  const busca: Prisma.PessoaWhereInput = !q
    ? {}
    : digitos.length === 11 || digitos.length === 14
      ? { cpf_cnpj_hash: hashBusca(digitos) }
      : { OR: [{ nome: { contains: q, mode: "insensitive" } }, { nome_fantasia: { contains: q, mode: "insensitive" } }] };
  const where: Prisma.PessoaWhereInput = { AND: [wherePessoaEscopo(u), busca, f.tipo ? { tipo: f.tipo } : {}] };
  const [total, itens] = await Promise.all([
    prisma.pessoa.count({ where }),
    prisma.pessoa.findMany({
      where,
      select: { ...SELECAO_PESSOA_PUBLICA, municipio: { select: { nome: true } }, responsavel_tecnico: { select: { id: true } } },
      orderBy: { nome: "asc" },
      skip: f.skip ?? 0,
      take: f.take ?? 20,
    }),
  ]);
  return { total, itens };
}

function dadosGravacao(e: PessoaEntrada) {
  const doc = somenteDigitos(e.cpf_cnpj);
  const pf = e.tipo === "PF";
  return {
    tipo: e.tipo,
    cpf_cnpj_cifrado: cifrar(doc),
    cpf_cnpj_hash: hashBusca(doc),
    cpf_cnpj_mascara: mascararCpfCnpj(doc),
    nome: e.nome,
    nome_fantasia: e.nome_fantasia,
    email: e.email ? (pf ? cifrar(e.email) : e.email) : null,
    telefone: e.telefone ? (pf ? cifrar(e.telefone) : e.telefone) : null,
    endereco: (e.endereco ?? undefined) as Prisma.InputJsonValue | undefined,
    municipio_id: e.municipio_id ?? null,
  };
}

/** Registro para auditoria: nunca grava CPF/e-mail/telefone de PF em claro no log. */
function paraLog(p: Pessoa | null) {
  if (!p) return null;
  return { id: p.id, tipo: p.tipo, nome: p.nome, nome_fantasia: p.nome_fantasia, cpf_cnpj_mascara: p.cpf_cnpj_mascara, municipio_id: p.municipio_id, endereco: p.endereco, email: p.tipo === "PJ" ? p.email : p.email ? "[cifrado]" : null, telefone: p.tipo === "PJ" ? p.telefone : p.telefone ? "[cifrado]" : null };
}

async function checarDuplicidade(u: UsuarioSessao, hash: string, ignorarId?: string) {
  const existente = await prisma.pessoa.findUnique({ where: { cpf_cnpj_hash: hash }, select: { id: true, nome: true } });
  if (existente && existente.id !== ignorarId) {
    const visivel = await podeVerPessoa(u, existente.id);
    throw invalido("Já existe uma pessoa cadastrada com este CPF/CNPJ.", { campo: "cpf_cnpj", pessoa_id: visivel ? existente.id : null, nome: visivel ? existente.nome : null });
  }
}

function checarMunicipio(u: UsuarioSessao, acao: "criar" | "editar", municipioId: string | null | undefined) {
  if (!can(u, acao, "pessoa", municipioId ?? undefined)) throw proibido("Sem permissão para " + (acao === "criar" ? "cadastrar" : "editar") + " pessoas neste município.");
  // Usuário municipal deve vincular a pessoa a um município do seu escopo.
  if (!temEscopoOrganizacao(u) && !municipioId) throw invalido("Informe o município da pessoa.", { campo: "municipio_id" });
}

export async function criarPessoa(u: UsuarioSessao, entrada: unknown) {
  const e = PessoaSchema.parse(entrada);
  checarMunicipio(u, "criar", e.municipio_id);
  const dados = dadosGravacao(e);
  await checarDuplicidade(u, dados.cpf_cnpj_hash);
  // Organização da pessoa: a do município informado ou a do usuário que cadastra (isolamento por cliente).
  const org = e.municipio_id ? (await prisma.municipio.findUnique({ where: { id: e.municipio_id }, select: { organizacao_id: true } }))?.organizacao_id : u.organizacao_id;
  return prisma.$transaction(async (tx) => {
    const p = await tx.pessoa.create({ data: { ...dados, organizacao_id: org ?? null, created_by: u.id } });
    await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "pessoa", entidade_id: p.id, depois: paraLog(p) }, tx);
    return p;
  });
}

export async function atualizarPessoa(u: UsuarioSessao, id: string, entrada: unknown) {
  const atual = await prisma.pessoa.findUnique({ where: { id } }).catch(() => null);
  if (!atual) throw naoEncontrado("Pessoa não encontrada.");
  if (!(await podeVerPessoa(u, id))) throw proibido();
  if (!podeVerDadosPessoais(u, atual)) throw proibido("Sem permissão para editar esta pessoa.");
  // PATCH parcial: mescla com os dados atuais decifrados
  const base = decifrarPessoa(atual);
  const bruto = { tipo: base.tipo, cpf_cnpj: base.cpf_cnpj ?? "", nome: base.nome, nome_fantasia: base.nome_fantasia, email: base.email, telefone: base.telefone, endereco: base.endereco, municipio_id: base.municipio_id, ...((entrada ?? {}) as object) };
  const e = PessoaSchema.parse(bruto);
  checarMunicipio(u, "editar", e.municipio_id ?? atual.municipio_id);
  const dados = dadosGravacao(e);
  if (dados.cpf_cnpj_hash !== atual.cpf_cnpj_hash) await checarDuplicidade(u, dados.cpf_cnpj_hash, id);
  return prisma.$transaction(async (tx) => {
    const p = await tx.pessoa.update({ where: { id }, data: dados });
    await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "pessoa", entidade_id: id, antes: paraLog(atual), depois: paraLog(p) }, tx);
    return p;
  });
}
