import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { naoEncontrado, proibido } from "@/lib/http";
import { UUID_NENHUM, type UsuarioSessao } from "@/lib/rbac";
import { wherePessoaOrganizacao } from "@/lib/cadastros/escopo";

// Isolamento por organização na ADMINISTRAÇÃO: o ADMIN de um cliente só lê/altera municípios, usuários e
// configurações (tipos de ato, tipologias, prazos, checklists, modelos, feriados municipais) da SUA organização.

/** Id da organização do admin (403 se o usuário não tiver organização). */
export function organizacaoDoAdmin(u: Pick<UsuarioSessao, "organizacao_id">): string {
  if (!u.organizacao_id) throw proibido("Seu usuário não está vinculado a uma organização.");
  return u.organizacao_id;
}

/** Municípios da organização do admin. */
export function whereMunicipiosAdmin(u: Pick<UsuarioSessao, "organizacao_id">): Prisma.MunicipioWhereInput {
  return { organizacao_id: u.organizacao_id ?? UUID_NENHUM };
}

/**
 * Usuários que o admin enxerga/administra: os da organização e requerentes (sem organização) vinculados a
 * pessoas da organização. Usuários internos de outro cliente nunca aparecem.
 */
export function whereUsuariosAdmin(u: UsuarioSessao): Prisma.UsuarioWhereInput {
  if (!u.organizacao_id) return { id: UUID_NENHUM };
  return { OR: [{ organizacao_id: u.organizacao_id }, { organizacao_id: null, pessoa: wherePessoaOrganizacao(u) }] };
}

/** Garante que o município (se informado) é da organização do admin; 404 para ids de outro cliente. */
export async function exigirMunicipioDoAdmin(u: Pick<UsuarioSessao, "organizacao_id">, municipioId: string | null | undefined) {
  if (!municipioId) return;
  const ok = await prisma.municipio.count({ where: { id: municipioId, ...whereMunicipiosAdmin(u) } }).catch(() => 0);
  if (!ok) throw naoEncontrado("Município não encontrado.");
}
