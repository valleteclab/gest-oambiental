import "server-only";
import { prisma } from "@/lib/db";
import { wherePessoaEscopo } from "@/lib/cadastros/escopo";
import type { UsuarioSessao } from "@/lib/rbac";

/** Pessoas físicas do escopo ainda sem cadastro de RT (+ a atual, na edição). */
export async function pessoasFisicasDisponiveis(u: UsuarioSessao, incluirId?: string) {
  return prisma.pessoa.findMany({
    where: { AND: [wherePessoaEscopo(u), { tipo: "PF" }, { OR: [{ responsavel_tecnico: null }, ...(incluirId ? [{ id: incluirId }] : [])] }] },
    select: { id: true, nome: true, cpf_cnpj_mascara: true },
    orderBy: { nome: "asc" },
    take: 1000,
  });
}
