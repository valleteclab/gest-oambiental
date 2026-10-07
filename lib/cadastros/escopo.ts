import type { Prisma } from "@prisma/client";
import { escopoMunicipios, isInterno, temEscopoOrganizacao, UUID_NENHUM, whereMunicipio, type UsuarioSessao } from "@/lib/rbac";

// Filtros de escopo dos cadastros (SPEC 4.1). Nunca confiar no front.

/** Pessoas vinculadas a registros dos municípios `m` (cadastro, empreendimento, processo, RT). */
function vinculadasAos(m: { in: string[] }): Prisma.PessoaWhereInput[] {
  return [
    { municipio_id: m },
    { empreendimentos: { some: { municipio_id: m } } },
    { processos: { some: { municipio_id: m } } },
    { responsavel_tecnico: { processos: { some: { municipio_id: m } } } },
    { responsavel_tecnico: { empreendimentos: { some: { empreendimento: { municipio_id: m } } } } },
  ];
}

/**
 * Pessoas da ORGANIZAÇÃO do usuário: cadastradas por ela (pessoa.organizacao_id) ou vinculadas a registros
 * dos seus municípios. Base do cadastro de RTs e do escopo organização – nunca inclui pessoas só de outro cliente.
 */
export function wherePessoaOrganizacao(u: UsuarioSessao): Prisma.PessoaWhereInput {
  if (!u.organizacao_id) return { id: UUID_NENHUM };
  return { OR: [{ organizacao_id: u.organizacao_id }, ...vinculadasAos({ in: u.municipios_org })] };
}

/**
 * Pessoas visíveis: escopo organização → pessoas da organização (wherePessoaOrganizacao); municipal → pessoas
 * do(s) município(s) ou vinculadas a empreendimento/processo desses municípios; requerente → apenas a própria pessoa.
 */
export function wherePessoaEscopo(u: UsuarioSessao): Prisma.PessoaWhereInput {
  if (!isInterno(u)) return { id: u.pessoa_id ?? UUID_NENHUM };
  if (temEscopoOrganizacao(u)) return wherePessoaOrganizacao(u);
  return { OR: vinculadasAos({ in: escopoMunicipios(u) }) };
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
 * Responsáveis técnicos: cadastro profissional (nome, conselho, registro) é visível a todo usuário interno DA
 * ORGANIZAÇÃO – o técnico precisa escolher RTs que atuam em vários municípios dela; RTs só de outro cliente não
 * aparecem. Dados pessoais seguem o escopo de pessoa. Requerente vê apenas o próprio registro de RT.
 */
export function whereResponsavelEscopo(u: UsuarioSessao): Prisma.ResponsavelTecnicoWhereInput {
  if (isInterno(u)) return { pessoa: wherePessoaOrganizacao(u) };
  return { pessoa_id: u.pessoa_id ?? UUID_NENHUM };
}
