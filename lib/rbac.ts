import type { Papel } from "@prisma/client";

// Matriz de permissões (SPEC 4.2). Toda query de negócio passa por escopoMunicipios()/whereMunicipio().
//
// ISOLAMENTO POR ORGANIZAÇÃO (tenant/cliente SaaS): cada usuário interno pertence a UMA organização
// (usuario.organizacao_id). Papéis de organização (ADMIN, TEC_CONSORCIO, SEMA_INEMA) enxergam somente os
// municípios dessa organização (`municipios_org`, carregado na sessão por carregarUsuario()); papéis
// municipais, somente os municípios dos seus papéis (dentro da organização). Requerentes são globais
// (organizacao_id NULL) e são filtrados por titularidade. Sem organização → escopo vazio (nega por padrão).

export type PapelVinculo = { papel: Papel; municipio_id: string | null };

export type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  cargo: string | null;
  pessoa_id: string | null;
  trocar_senha: boolean;
  papeis: PapelVinculo[];
  /** Organização (tenant) do usuário interno; null para requerentes. */
  organizacao_id: string | null;
  /** Ids de TODOS os municípios da organização do usuário (ativos ou não); [] sem organização. */
  municipios_org: string[];
};

/** Dados mínimos para decidir acesso a órgão/município (sessão completa ou só papéis + organização). */
export type AcessoUsuario = Pick<UsuarioSessao, "papeis" | "organizacao_id" | "municipios_org">;

export type Acao =
  | "ver"
  | "criar"
  | "editar"
  | "triar"
  | "analisar"
  | "pendencia"
  | "parecer"
  | "decidir"
  | "emitir_documento"
  | "cancelar_documento"
  | "fiscalizar"
  | "exportar"
  | "configurar"
  | "requerer";

export type Recurso =
  | "processo"
  | "empreendimento"
  | "pessoa"
  | "fiscalizacao"
  | "denuncia"
  | "documento"
  | "relatorio"
  | "dashboard"
  | "admin"
  | "auditoria"
  | "exportacao";

const TECNICO: Acao[] = ["ver", "criar", "editar", "triar", "analisar", "pendencia", "parecer", "emitir_documento", "fiscalizar"];

const MATRIZ: Record<Papel, Partial<Record<Recurso, Acao[]>>> = {
  ADMIN: {
    processo: ["ver", "criar", "editar", "triar", "analisar", "pendencia", "parecer", "decidir", "emitir_documento"],
    empreendimento: ["ver", "criar", "editar"],
    pessoa: ["ver", "criar", "editar"],
    fiscalizacao: ["ver", "criar", "editar", "fiscalizar", "emitir_documento"],
    denuncia: ["ver", "criar", "editar"],
    documento: ["ver", "emitir_documento", "cancelar_documento"],
    relatorio: ["ver", "exportar"],
    dashboard: ["ver"],
    admin: ["ver", "configurar"],
    auditoria: ["ver"],
    exportacao: ["ver", "exportar"],
  },
  TEC_CONSORCIO: {
    processo: TECNICO,
    empreendimento: ["ver", "criar", "editar"],
    pessoa: ["ver", "criar", "editar"],
    fiscalizacao: ["ver", "criar", "editar", "fiscalizar", "emitir_documento"],
    denuncia: ["ver", "criar", "editar"],
    documento: ["ver", "emitir_documento"],
    relatorio: ["ver", "exportar"],
    dashboard: ["ver"],
  },
  TEC_MUNICIPAL: {
    processo: TECNICO,
    empreendimento: ["ver", "criar", "editar"],
    pessoa: ["ver", "criar", "editar"],
    fiscalizacao: ["ver", "criar", "editar", "fiscalizar", "emitir_documento"],
    denuncia: ["ver", "criar", "editar"],
    documento: ["ver", "emitir_documento"],
    relatorio: ["ver", "exportar"],
    dashboard: ["ver"],
  },
  GESTOR_MUNICIPAL: {
    // "criar" processo/pessoa: protocolo no balcão (podeProtocolarNoBalcao)
    processo: ["ver", "criar", "triar", "decidir", "emitir_documento"],
    empreendimento: ["ver"],
    pessoa: ["ver", "criar"],
    fiscalizacao: ["ver", "emitir_documento"],
    denuncia: ["ver"],
    documento: ["ver", "emitir_documento", "cancelar_documento"],
    relatorio: ["ver", "exportar"],
    dashboard: ["ver"],
  },
  FISCAL: {
    processo: ["ver"],
    empreendimento: ["ver"],
    pessoa: ["ver", "criar"],
    fiscalizacao: ["ver", "criar", "editar", "fiscalizar", "emitir_documento"],
    denuncia: ["ver", "criar", "editar"],
    documento: ["ver", "emitir_documento"],
    dashboard: ["ver"],
  },
  SEMA_INEMA: {
    processo: ["ver"],
    empreendimento: ["ver"],
    pessoa: ["ver"],
    fiscalizacao: ["ver"],
    denuncia: ["ver"],
    documento: ["ver"],
    relatorio: ["ver", "exportar"],
    dashboard: ["ver"],
    exportacao: ["ver", "exportar"],
  },
  REQUERENTE: {
    processo: ["ver", "criar", "requerer"],
    empreendimento: ["ver", "criar"],
    documento: ["ver"],
  },
};

/** Papéis cujo escopo é a organização inteira (todos os municípios DA ORGANIZAÇÃO do usuário). */
export const PAPEIS_ORGANIZACAO: Papel[] = ["ADMIN", "TEC_CONSORCIO", "SEMA_INEMA"];

export const PAPEIS_INTERNOS: Papel[] = ["ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL", "FISCAL", "SEMA_INEMA"];

export function temPapel(u: UsuarioSessao, ...papeis: Papel[]): boolean {
  return u.papeis.some((p) => papeis.includes(p.papel));
}

export function isInterno(u: UsuarioSessao): boolean {
  return temPapel(u, ...PAPEIS_INTERNOS);
}

export function isSomenteLeitura(u: UsuarioSessao): boolean {
  return u.papeis.length > 0 && u.papeis.every((p) => p.papel === "SEMA_INEMA");
}

/** O município pertence à organização do usuário? (sem organização → nunca) */
export function municipioDaOrganizacao(u: Pick<UsuarioSessao, "organizacao_id" | "municipios_org">, municipioId: string): boolean {
  return !!u.organizacao_id && u.municipios_org.includes(municipioId);
}

/** O papel dá escopo sobre o município? (papel de organização → municípios da organização; municipal → o seu) */
function papelAlcanca(u: AcessoUsuario, p: PapelVinculo, municipioId: string): boolean {
  if (PAPEIS_ORGANIZACAO.includes(p.papel)) return municipioDaOrganizacao(u, municipioId);
  if (p.papel === "REQUERENTE") return false;
  if (p.municipio_id !== municipioId) return false;
  // Defesa em profundidade: papel municipal de usuário com organização só vale nos municípios dela.
  return !u.organizacao_id || u.municipios_org.includes(municipioId);
}

/**
 * Pode `acao` sobre `recurso`? Se `municipioId` for informado, o papel que concede a ação
 * precisa ter escopo nesse município (papel de organização: município da SUA organização).
 */
export function can(u: UsuarioSessao | null, acao: Acao, recurso: Recurso, municipioId?: string | null): boolean {
  if (!u) return false;
  return u.papeis.some((p) => {
    const acoes = MATRIZ[p.papel]?.[recurso];
    if (!acoes?.includes(acao)) return false;
    if (municipioId === undefined || municipioId === null) return true;
    if (p.papel === "REQUERENTE") return true; // requerente é filtrado por titularidade, não por município
    return papelAlcanca(u, p, municipioId);
  });
}

/** O usuário tem algum papel de escopo organização (ADMIN, TEC_CONSORCIO, SEMA_INEMA)? */
export function temEscopoOrganizacao(u: Pick<UsuarioSessao, "papeis">): boolean {
  return u.papeis.some((p) => PAPEIS_ORGANIZACAO.includes(p.papel));
}

/**
 * Protocolo no BALCÃO: servidor interno cria/protocola processo em nome de um requerente (/processos/novo).
 * ADMIN, TEC_CONSORCIO, TEC_MUNICIPAL e GESTOR_MUNICIPAL (no município do papel); nunca FISCAL, SEMA_INEMA
 * (somente leitura) nem o papel REQUERENTE (que só requer para si). Sem `municipioId`: em algum município.
 */
export function podeProtocolarNoBalcao(u: UsuarioSessao | null, municipioId?: string | null): boolean {
  if (!u || isSomenteLeitura(u)) return false;
  const interno: UsuarioSessao = { ...u, papeis: u.papeis.filter((p) => p.papel !== "REQUERENTE") };
  return can(interno, "criar", "processo", municipioId);
}

/**
 * Municípios visíveis para o usuário (papéis internos) – SEMPRE uma lista explícita de ids.
 * Escopo organização → todos os municípios da organização do usuário (nunca de outra organização).
 * Requerente puro retorna [] — use whereProcessoEscopo() que filtra por titularidade.
 */
export function escopoMunicipios(u: AcessoUsuario): string[] {
  const ids = new Set<string>();
  if (temEscopoOrganizacao(u) && u.organizacao_id) for (const m of u.municipios_org) ids.add(m);
  for (const p of u.papeis) {
    if (p.papel === "REQUERENTE" || PAPEIS_ORGANIZACAO.includes(p.papel) || !p.municipio_id) continue;
    if (papelAlcanca(u, p, p.municipio_id)) ids.add(p.municipio_id);
  }
  return [...ids];
}

/** UUID que nunca existe – usado para filtros "sem acesso" (colunas @db.Uuid não aceitam texto arbitrário). */
export const UUID_NENHUM = "00000000-0000-0000-0000-000000000000";

/**
 * Filtro Prisma `{ municipio_id: ... }` para tabelas com municipio_id – sempre explícito (nunca `{}`), então
 * nenhum usuário enxerga municípios de outra organização. Opcionalmente restringe a um município pedido.
 */
export function whereMunicipio(u: AcessoUsuario, municipioPedido?: string | null): { municipio_id: string | { in: string[] } } {
  const escopo = escopoMunicipios(u);
  if (municipioPedido) return { municipio_id: escopo.includes(municipioPedido) ? municipioPedido : UUID_NENHUM };
  return { municipio_id: { in: escopo } };
}

/** Filtro das tabelas de CONFIGURAÇÃO da organização do usuário (tipos de ato, tipologias, prazos, checklists…). */
export function whereOrganizacao(u: Pick<UsuarioSessao, "organizacao_id">): { organizacao_id: string } {
  return { organizacao_id: u.organizacao_id ?? UUID_NENHUM };
}

/**
 * Técnicos visíveis/atribuíveis no escopo do usuário: ativos, da MESMA organização, com papel TEC_MUNICIPAL
 * num município do escopo ou TEC_CONSORCIO (escopo organização).
 */
export function whereTecnicosEscopo(u: AcessoUsuario) {
  const escopo = escopoMunicipios(u);
  return {
    ativo: true,
    organizacao_id: u.organizacao_id ?? UUID_NENHUM,
    papeis: { some: { OR: [{ papel: "TEC_MUNICIPAL" as Papel, municipio_id: { in: escopo } }, { papel: "TEC_CONSORCIO" as Papel }] } },
  };
}

/** Filtro para processos: interno → por município; requerente → processos em que é requerente ou RT. */
export function whereProcessoEscopo(u: UsuarioSessao, municipioPedido?: string | null) {
  if (isInterno(u)) return whereMunicipio(u, municipioPedido);
  if (!u.pessoa_id) return { id: UUID_NENHUM };
  return { OR: [{ requerente_id: u.pessoa_id }, { rt: { pessoa_id: u.pessoa_id } }] };
}

/** O usuário pode ver este registro (por município)? Use para checar acesso por URL direta → 403. */
export function podeVerMunicipio(u: AcessoUsuario, municipioId: string): boolean {
  return escopoMunicipios(u).includes(municipioId);
}

/**
 * O usuário pode atuar no ÓRGÃO (município) escolhido no login / "Trocar órgão"?
 * - papéis de organização (ADMIN, TEC_CONSORCIO, SEMA_INEMA) → qualquer órgão DA SUA ORGANIZAÇÃO;
 * - REQUERENTE → qualquer órgão (pode requerer em qualquer município, de qualquer cliente);
 * - papéis municipais → somente os municípios dos seus papéis.
 * O órgão é CONTEXTO (padrões de filtro/cabeçalho), não substitui o escopo de whereMunicipio()/can().
 */
export function podeAcessarOrgao(u: AcessoUsuario, municipioId: string | null | undefined): boolean {
  if (!municipioId) return false;
  return u.papeis.some((p) => p.papel === "REQUERENTE" || papelAlcanca(u, p, municipioId));
}

/** Filtra a lista de órgãos (municípios) aos que o usuário pode escolher. */
export function orgaosPermitidos<T extends { id: string }>(u: AcessoUsuario, municipios: T[]): T[] {
  return municipios.filter((m) => podeAcessarOrgao(u, m.id));
}

/**
 * Filtro de município PADRÃO das listagens (painel, processos, prazos): se o parâmetro não veio na URL e o
 * usuário enxerga mais de um município, usa o órgão ativo. Parâmetro presente (mesmo vazio = "Todos") prevalece.
 */
export function filtroMunicipioPadrao(u: UsuarioSessao, pedido: string | string[] | undefined, orgaoAtivoId: string | null | undefined): string | undefined {
  if (pedido !== undefined) return Array.isArray(pedido) ? pedido[0] : pedido;
  if (!orgaoAtivoId || !podeVerMunicipio(u, orgaoAtivoId)) return undefined;
  return temEscopoOrganizacao(u) || escopoMunicipios(u).length > 1 ? orgaoAtivoId : undefined;
}

export const ROTULO_PAPEL: Record<Papel, string> = {
  ADMIN: "Administrador da organização",
  TEC_CONSORCIO: "Técnico da organização (consórcio)",
  TEC_MUNICIPAL: "Técnico municipal",
  GESTOR_MUNICIPAL: "Gestor ambiental municipal",
  FISCAL: "Fiscal ambiental",
  SEMA_INEMA: "Gestor estadual (SEMA/INEMA)",
  REQUERENTE: "Requerente",
};
