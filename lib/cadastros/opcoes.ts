import "server-only";
import { prisma } from "@/lib/db";
import { escopoMunicipios, type UsuarioSessao } from "@/lib/rbac";

// Listas para selects de formulários, já filtradas pelo escopo do usuário.
export async function municipiosDoEscopo(u: UsuarioSessao, apenasAtivos = true) {
  const esc = escopoMunicipios(u);
  return prisma.municipio.findMany({
    where: { ...(esc === "TODOS" ? {} : { id: { in: esc } }), ...(apenasAtivos ? { ativo: true } : {}) },
    select: { id: true, nome: true, sigla: true, latitude: true, longitude: true },
    orderBy: { nome: "asc" },
  });
}

export async function tipologiasAtivas() {
  return prisma.tipologia.findMany({ where: { ativo: true }, orderBy: { codigo: "asc" }, select: { id: true, codigo: true, descricao: true, unidade_porte: true, faixas_porte: true, potencial_poluidor: true } });
}
