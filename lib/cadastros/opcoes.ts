import "server-only";
import { prisma } from "@/lib/db";
import { getUsuario } from "@/lib/auth";
import { escopoMunicipios, whereOrganizacao, type UsuarioSessao } from "@/lib/rbac";

// Listas para selects de formulários, já filtradas pelo escopo do usuário.
export async function municipiosDoEscopo(u: UsuarioSessao, apenasAtivos = true) {
  const esc = escopoMunicipios(u);
  return prisma.municipio.findMany({
    where: { id: { in: esc }, ...(apenasAtivos ? { ativo: true } : {}) },
    select: { id: true, nome: true, sigla: true, latitude: true, longitude: true },
    orderBy: { nome: "asc" },
  });
}

/**
 * Tipologias ativas do catálogo da organização do usuário (isolamento por cliente). Sem `u`, usa o usuário
 * da requisição (getUsuario); sem usuário/organização → lista vazia.
 */
export async function tipologiasAtivas(u?: Pick<UsuarioSessao, "organizacao_id"> | null) {
  const usuario = u === undefined ? await getUsuario() : u;
  return prisma.tipologia.findMany({ where: { ativo: true, ...whereOrganizacao(usuario ?? { organizacao_id: null }) }, orderBy: { codigo: "asc" }, select: { id: true, codigo: true, descricao: true, unidade_porte: true, faixas_porte: true, potencial_poluidor: true } });
}
