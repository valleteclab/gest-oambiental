import type { Papel } from "@prisma/client";

// Matriz de permissões (SPEC 4.2). Toda query de negócio passa por escopoMunicipios()/whereMunicipio().

export type PapelVinculo = { papel: Papel; municipio_id: string | null };

export type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  cargo: string | null;
  pessoa_id: string | null;
  trocar_senha: boolean;
  papeis: PapelVinculo[];
};

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
    processo: ["ver", "triar", "decidir", "emitir_documento"],
    empreendimento: ["ver"],
    pessoa: ["ver"],
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

/** Papéis cujo escopo é a organização inteira (todos os municípios). */
const PAPEIS_ORGANIZACAO: Papel[] = ["ADMIN", "TEC_CONSORCIO", "SEMA_INEMA"];

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

/**
 * Pode `acao` sobre `recurso`? Se `municipioId` for informado, o papel que concede a ação
 * precisa ter escopo nesse município (ou escopo organização).
 */
export function can(u: UsuarioSessao | null, acao: Acao, recurso: Recurso, municipioId?: string | null): boolean {
  if (!u) return false;
  return u.papeis.some((p) => {
    const acoes = MATRIZ[p.papel]?.[recurso];
    if (!acoes?.includes(acao)) return false;
    if (municipioId === undefined || municipioId === null) return true;
    if (PAPEIS_ORGANIZACAO.includes(p.papel)) return true;
    if (p.papel === "REQUERENTE") return true; // requerente é filtrado por titularidade, não por município
    return p.municipio_id === municipioId;
  });
}

/**
 * Municípios visíveis para o usuário (papéis internos). `"TODOS"` = escopo organização.
 * Requerente puro retorna [] — use whereProcessoEscopo() que filtra por titularidade.
 */
export function escopoMunicipios(u: UsuarioSessao): "TODOS" | string[] {
  if (u.papeis.some((p) => PAPEIS_ORGANIZACAO.includes(p.papel))) return "TODOS";
  return [...new Set(u.papeis.filter((p) => p.papel !== "REQUERENTE" && p.municipio_id).map((p) => p.municipio_id!))];
}

/** UUID que nunca existe – usado para filtros "sem acesso" (colunas @db.Uuid não aceitam texto arbitrário). */
export const UUID_NENHUM = "00000000-0000-0000-0000-000000000000";

/** Filtro Prisma `{ municipio_id: ... }` para tabelas com municipio_id. Opcionalmente restringe a um município pedido. */
export function whereMunicipio(u: UsuarioSessao, municipioPedido?: string | null): { municipio_id?: string | { in: string[] } } {
  const escopo = escopoMunicipios(u);
  if (escopo === "TODOS") return municipioPedido ? { municipio_id: municipioPedido } : {};
  if (municipioPedido) return { municipio_id: escopo.includes(municipioPedido) ? municipioPedido : UUID_NENHUM };
  return { municipio_id: { in: escopo } };
}

/** Filtro para processos: interno → por município; requerente → processos em que é requerente ou RT. */
export function whereProcessoEscopo(u: UsuarioSessao, municipioPedido?: string | null) {
  if (isInterno(u)) return whereMunicipio(u, municipioPedido);
  if (!u.pessoa_id) return { id: UUID_NENHUM };
  return { OR: [{ requerente_id: u.pessoa_id }, { rt: { pessoa_id: u.pessoa_id } }] };
}

/** O usuário pode ver este registro (por município)? Use para checar acesso por URL direta → 403. */
export function podeVerMunicipio(u: UsuarioSessao, municipioId: string): boolean {
  const escopo = escopoMunicipios(u);
  return escopo === "TODOS" || escopo.includes(municipioId);
}

export const ROTULO_PAPEL: Record<Papel, string> = {
  ADMIN: "Administrador do consórcio",
  TEC_CONSORCIO: "Técnico do consórcio",
  TEC_MUNICIPAL: "Técnico municipal",
  GESTOR_MUNICIPAL: "Gestor ambiental municipal",
  FISCAL: "Fiscal ambiental",
  SEMA_INEMA: "Gestor estadual (SEMA/INEMA)",
  REQUERENTE: "Requerente",
};
