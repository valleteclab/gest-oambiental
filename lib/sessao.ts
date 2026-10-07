// Montagem da sessão (UsuarioSessao) a partir do banco – sem dependências do Next (usada por lib/auth.ts,
// seeds, scripts e jobs). Inclui a organização do usuário e os ids de TODOS os municípios dela
// (`municipios_org`), base do isolamento por organização em lib/rbac.ts.
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { UsuarioSessao } from "./rbac";

export const INCLUDE_SESSAO = {
  papeis: true,
  organizacao: { select: { status: true, modulos: true, municipios: { select: { id: true } } } },
} satisfies Prisma.UsuarioInclude;

type UsuarioComSessao = Prisma.UsuarioGetPayload<{ include: typeof INCLUDE_SESSAO }>;

export function montarSessao(u: UsuarioComSessao): UsuarioSessao {
  // Módulo de LICENCIAMENTO desativado no cliente (painel /plataforma): a sessão perde os papéis e os municípios do
  // licenciamento (o acesso é bloqueado; os dados permanecem). Requerentes (sem organização) não são afetados.
  const semLicenciamento = !!u.organizacao && !u.organizacao.modulos.includes("LICENCIAMENTO");
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    cargo: u.cargo,
    pessoa_id: u.pessoa_id,
    trocar_senha: u.trocar_senha,
    papeis: semLicenciamento ? [] : u.papeis.map((p) => ({ papel: p.papel, municipio_id: p.municipio_id })),
    organizacao_id: u.organizacao_id,
    municipios_org: semLicenciamento ? [] : (u.organizacao?.municipios.map((m) => m.id) ?? []),
  };
}

/**
 * Sessão de um usuário ATIVO pelo id (null se inexistente/inativo OU se a organização do usuário está SUSPENSA).
 * Todo acesso autenticado (cookie, refresh, Bearer, jobs por usuário) passa por aqui: suspender o cliente derruba as sessões.
 */
export async function sessaoPorId(id: string): Promise<UsuarioSessao | null> {
  const u = await prisma.usuario.findUnique({ where: { id }, include: INCLUDE_SESSAO }).catch(() => null);
  if (!u || !u.ativo || (u.organizacao && u.organizacao.status !== "ATIVO")) return null;
  return montarSessao(u);
}

/** Sessão pelo e-mail (seeds/scripts). Lança erro se o usuário não existir. */
export async function sessaoPorEmail(email: string): Promise<UsuarioSessao> {
  const u = await prisma.usuario.findUnique({ where: { email }, include: INCLUDE_SESSAO });
  if (!u) throw new Error(`Usuário ${email} não encontrado.`);
  return montarSessao(u);
}
