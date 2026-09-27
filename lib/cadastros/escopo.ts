import type { Prisma } from "@prisma/client";
import { escopoMunicipios, isInterno, UUID_NENHUM, whereMunicipio, type UsuarioSessao } from "@/lib/rbac";

// Filtros de escopo dos cadastros (SPEC 4.1). Nunca confiar no front.

/**
 * Pessoas visíveis: escopo organização → todas; municipal → pessoas do(s) município(s) ou vinculadas
 * a empreendimento/processo desses municípios; requerente → apenas a própria pessoa.
 */
export function wherePessoaEscopo(u: UsuarioSessao): Prisma.PessoaWhereInput {
  if (!isInterno(u)) return { id: u.pessoa_id ?? UUID_NENHUM };
  const esc = escopoMunicipios(u);
  if (esc === "TODOS") return {};
  const m = { in: esc };
  return {
    OR: [
      { municipio_id: m },
      { empreendimentos: { some: { municipio_id: m } } },
      { processos: { some: { municipio_id: m } } },
      { responsavel_tecnico: { processos: { some: { municipio_id: m } } } },
      { responsavel_tecnico: { empreendimentos: { some: { empreendimento: { municipio_id: m } } } } },
    ],
  };
}

/** Empreendimentos visíveis: interno → por município; requerente → os seus (ou em que é RT). */
export function whereEmpreendimentoEscopo(u: UsuarioSessao, municipioPedido?: string | null): Prisma.EmpreendimentoWhereInput {
  if (isInterno(u)) return whereMunicipio(u, municipioPedido);
  if (!u.pessoa_id) return { id: UUID_NENHUM };
  return {
    ...(municipioPedido ? { municipio_id: municipioPedido } : {}),
    OR: [{ requerente_id: u.pessoa_id }, { rts: { some: { rt: { pessoa_id: u.pessoa_id }, ate: null } } }],
  };
}

/**
 * Responsáveis técnicos: cadastro profissional (nome, conselho, registro) é visível a todo usuário interno
 * – o técnico precisa escolher RTs que atuam em vários municípios. Dados pessoais seguem o escopo de pessoa.
 * Requerente vê apenas o próprio registro de RT.
 */
export function whereResponsavelEscopo(u: UsuarioSessao): Prisma.ResponsavelTecnicoWhereInput {
  if (isInterno(u)) return {};
  return { pessoa_id: u.pessoa_id ?? UUID_NENHUM };
}
