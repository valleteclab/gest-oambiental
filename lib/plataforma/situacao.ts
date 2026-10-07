// Situação do cliente (organização) na plataforma: filtros e predicados usados em TODOS os pontos de entrada
// (sessão, login, portais públicos, canais, jobs). Sem server-only: também é usado por sessao.ts, jobs e seeds.
// Suspenso = ninguém da organização entra, portais públicos/canais do cliente ficam fora do ar e os jobs a ignoram;
// os dados são preservados. Módulo desativado = o acesso àquele módulo é bloqueado, sem apagar dados.
import type { ModuloPlataforma, StatusOrganizacao } from "@prisma/client";

type OrgSituacao = { status: StatusOrganizacao; modulos: ModuloPlataforma[] };

/** Filtro Prisma de organização ativa (não suspensa). */
export const ORG_ATIVA = { status: "ATIVO" } as const;
/** Organização ativa com o módulo de licenciamento. */
export const ORG_LICENCIAMENTO_ATIVA = { status: "ATIVO", modulos: { has: "LICENCIAMENTO" } } as const;
/** Organização ativa com o módulo GED. */
export const ORG_GED_ATIVA = { status: "ATIVO", modulos: { has: "GED" } } as const;

export const orgAtiva = (o: Pick<OrgSituacao, "status"> | null | undefined) => !!o && o.status === "ATIVO";
export const licenciamentoAtivo = (o: OrgSituacao | null | undefined) => !!o && o.status === "ATIVO" && o.modulos.includes("LICENCIAMENTO");
export const gedAtivo = (o: OrgSituacao | null | undefined) => !!o && o.status === "ATIVO" && o.modulos.includes("GED");

export const MENSAGEM_CLIENTE_SUSPENSO = "O acesso desta organização está suspenso. Entre em contato com o administrador da plataforma.";
