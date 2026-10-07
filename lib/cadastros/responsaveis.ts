import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { hashBusca, somenteDigitos } from "@/lib/crypto";
import { invalido, naoEncontrado, proibido } from "@/lib/http";
import { can, isInterno, type UsuarioSessao } from "@/lib/rbac";
import { whereResponsavelEscopo } from "./escopo";
import { podeVerPessoa } from "./pessoas";
import { ResponsavelSchema } from "./validacao";

// Responsáveis técnicos (SPEC 5.2): vínculo 1:1 com pessoa física.

export async function listarResponsaveis(u: UsuarioSessao, f: { q?: string | null; skip?: number; take?: number }) {
  const q = (f.q ?? "").trim();
  const d = somenteDigitos(q);
  const busca: Prisma.ResponsavelTecnicoWhereInput = !q
    ? {}
    : d.length === 11
      ? { pessoa: { cpf_cnpj_hash: hashBusca(d) } }
      : { OR: [{ pessoa: { nome: { contains: q, mode: "insensitive" } } }, { registro_conselho: { contains: q, mode: "insensitive" } }, { formacao: { contains: q, mode: "insensitive" } }] };
  const where: Prisma.ResponsavelTecnicoWhereInput = { AND: [whereResponsavelEscopo(u), busca] };
  const [total, itens] = await Promise.all([
    prisma.responsavelTecnico.count({ where }),
    prisma.responsavelTecnico.findMany({
      where,
      include: { pessoa: { select: { id: true, nome: true, cpf_cnpj_mascara: true } }, _count: { select: { empreendimentos: { where: { ate: null } }, processos: true } } },
      orderBy: { pessoa: { nome: "asc" } },
      skip: f.skip ?? 0,
      take: f.take ?? 20,
    }),
  ]);
  return { total, itens };
}

export async function obterResponsavel(u: UsuarioSessao, id: string) {
  const rt = await prisma.responsavelTecnico
    .findFirst({ where: { AND: [{ id }, whereResponsavelEscopo(u)] }, include: { pessoa: { select: { id: true, nome: true, cpf_cnpj_mascara: true, municipio_id: true } } } })
    .catch(() => null);
  if (rt) return rt;
  const existe = await prisma.responsavelTecnico.count({ where: { id } }).catch(() => 0);
  return existe ? "PROIBIDO" : null;
}

function paraLog(r: { id: string; pessoa_id: string; formacao: string; conselho: string; registro_conselho: string; uf_conselho: string }) {
  return { id: r.id, pessoa_id: r.pessoa_id, formacao: r.formacao, conselho: r.conselho, registro_conselho: r.registro_conselho, uf_conselho: r.uf_conselho };
}

async function validarPessoa(u: UsuarioSessao, pessoaId: string, ignorarRt?: string) {
  const p = await prisma.pessoa.findUnique({ where: { id: pessoaId }, include: { responsavel_tecnico: { select: { id: true } } } });
  if (!p) throw invalido("Pessoa não encontrada.", { campo: "pessoa_id" });
  if (p.tipo !== "PF") throw invalido("O responsável técnico deve ser pessoa física.", { campo: "pessoa_id" });
  if (!(await podeVerPessoa(u, pessoaId))) throw proibido("Pessoa fora do seu escopo.");
  if (p.responsavel_tecnico && p.responsavel_tecnico.id !== ignorarRt) throw invalido("Esta pessoa já está cadastrada como responsável técnico.", { campo: "pessoa_id", rt_id: p.responsavel_tecnico.id });
}

export async function criarResponsavel(u: UsuarioSessao, entrada: unknown) {
  if (!isInterno(u) || !can(u, "criar", "pessoa")) throw proibido("Sem permissão para cadastrar responsáveis técnicos.");
  const e = ResponsavelSchema.parse(entrada);
  await validarPessoa(u, e.pessoa_id);
  return prisma.$transaction(async (tx) => {
    const r = await tx.responsavelTecnico.create({ data: { ...e, created_by: u.id } });
    await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "responsavel_tecnico", entidade_id: r.id, depois: paraLog(r) }, tx);
    return r;
  });
}

export async function atualizarResponsavel(u: UsuarioSessao, id: string, entrada: unknown) {
  if (!isInterno(u) || !can(u, "editar", "pessoa")) throw proibido("Sem permissão para editar responsáveis técnicos.");
  const atual = await prisma.responsavelTecnico.findUnique({ where: { id } }).catch(() => null);
  if (!atual) throw naoEncontrado("Responsável técnico não encontrado.");
  const e = ResponsavelSchema.parse({ ...paraLog(atual), ...((entrada ?? {}) as object) });
  if (e.pessoa_id !== atual.pessoa_id) await validarPessoa(u, e.pessoa_id, id);
  return prisma.$transaction(async (tx) => {
    const r = await tx.responsavelTecnico.update({ where: { id }, data: e });
    await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "responsavel_tecnico", entidade_id: id, antes: paraLog(atual), depois: paraLog(r) }, tx);
    return r;
  });
}
