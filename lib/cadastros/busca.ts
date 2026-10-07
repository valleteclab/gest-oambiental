import "server-only";
import { prisma } from "@/lib/db";
import { hashBusca, somenteDigitos } from "@/lib/crypto";
import { whereProcessoEscopo, type UsuarioSessao } from "@/lib/rbac";
import { whereEmpreendimentoEscopo, wherePessoaEscopo } from "./escopo";

// Busca global (SPEC 9.4): nº de processo, CPF/CNPJ (via hash), nome de pessoa, empreendimento – sempre no escopo.

export type ResultadoBusca = Awaited<ReturnType<typeof buscaGlobal>>;

export async function buscaGlobal(u: UsuarioSessao, termo: string, limite = 20) {
  const q = termo.trim();
  if (q.length < 2) return { termo: q, porDocumento: false, processos: [], pessoas: [], empreendimentos: [] };
  const d = somenteDigitos(q);
  const porDocumento = (d.length === 11 || d.length === 14) && /^[\d.\-/\s]+$/.test(q);

  if (porDocumento) {
    const hash = hashBusca(d);
    const [pessoas, processos, empreendimentos] = await Promise.all([
      prisma.pessoa.findMany({ where: { AND: [{ cpf_cnpj_hash: hash }, wherePessoaEscopo(u)] }, select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true }, take: limite }),
      prisma.processo.findMany({
        where: { AND: [whereProcessoEscopo(u), { OR: [{ requerente: { cpf_cnpj_hash: hash } }, { rt: { pessoa: { cpf_cnpj_hash: hash } } }] }] },
        include: { empreendimento: { select: { nome: true } }, tipo_ato: { select: { sigla: true } }, municipio: { select: { sigla: true } } },
        orderBy: { created_at: "desc" },
        take: limite,
      }),
      prisma.empreendimento.findMany({
        where: { AND: [whereEmpreendimentoEscopo(u), { requerente: { cpf_cnpj_hash: hash } }] },
        include: { municipio: { select: { nome: true } }, requerente: { select: { nome: true } } },
        take: limite,
      }),
    ]);
    return { termo: q, porDocumento: true, processos, pessoas, empreendimentos };
  }

  const contem = { contains: q, mode: "insensitive" as const };
  const [processos, pessoas, empreendimentos] = await Promise.all([
    prisma.processo.findMany({
      where: { AND: [whereProcessoEscopo(u), { OR: [{ numero: contem }, { empreendimento: { nome: contem } }, { requerente: { nome: contem } }] }] },
      include: { empreendimento: { select: { nome: true } }, tipo_ato: { select: { sigla: true } }, municipio: { select: { sigla: true } } },
      orderBy: { created_at: "desc" },
      take: limite,
    }),
    prisma.pessoa.findMany({
      where: { AND: [wherePessoaEscopo(u), { OR: [{ nome: contem }, { nome_fantasia: contem }] }] },
      select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true },
      orderBy: { nome: "asc" },
      take: limite,
    }),
    prisma.empreendimento.findMany({
      where: { AND: [whereEmpreendimentoEscopo(u), { OR: [{ nome: contem }, { numero_car: contem }] }] },
      include: { municipio: { select: { nome: true } }, requerente: { select: { nome: true } } },
      orderBy: { nome: "asc" },
      take: limite,
    }),
  ]);
  return { termo: q, porDocumento: false, processos, pessoas, empreendimentos };
}
