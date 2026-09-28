// Montagem da sessão (UsuarioSessao) a partir do banco – sem dependências do Next (usada por lib/auth.ts,
// seeds, scripts e jobs). Inclui a organização do usuário e os ids de TODOS os municípios dela
// (`municipios_org`), base do isolamento por organização em lib/rbac.ts.
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { UsuarioSessao } from "./rbac";

export const INCLUDE_SESSAO = {
  papeis: true,
  organizacao: { select: { municipios: { select: { id: true } } } },
} satisfies Prisma.UsuarioInclude;

type UsuarioComSessao = Prisma.UsuarioGetPayload<{ include: typeof INCLUDE_SESSAO }>;

export function montarSessao(u: UsuarioComSessao): UsuarioSessao {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    cargo: u.cargo,
    pessoa_id: u.pessoa_id,
    trocar_senha: u.trocar_senha,
    papeis: u.papeis.map((p) => ({ papel: p.papel, municipio_id: p.municipio_id })),
    organizacao_id: u.organizacao_id,
    municipios_org: u.organizacao?.municipios.map((m) => m.id) ?? [],
  };
}

/** Sessão de um usuário ATIVO pelo id (null se inexistente/inativo). */
export async function sessaoPorId(id: string): Promise<UsuarioSessao | null> {
  const u = await prisma.usuario.findUnique({ where: { id }, include: INCLUDE_SESSAO }).catch(() => null);
  return u && u.ativo ? montarSessao(u) : null;
}

/** Sessão pelo e-mail (seeds/scripts). Lança erro se o usuário não existir. */
export async function sessaoPorEmail(email: string): Promise<UsuarioSessao> {
  const u = await prisma.usuario.findUnique({ where: { email }, include: INCLUDE_SESSAO });
  if (!u) throw new Error(`Usuário ${email} não encontrado.`);
  return montarSessao(u);
}
