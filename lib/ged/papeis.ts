// Matriz de papéis do GED (GedPapel) – docs/ged-design.md §7 e decisões do dono do produto.
// Funções puras (sem banco): testadas em tests/unit/ged-permissoes.test.ts.
//
// MODELO: um papel define um TETO de ações (e de capacidades administrativas). A permissão efetiva sobre
// um documento/pasta é  (o que a posse/ACL/trâmite/assinatura concede)  ∩  (teto do papel)  – ver permissoes.ts.
//
//   Papel         Teto de ações no documento/pasta                         Capacidades administrativas
//   GED_ADMIN     VER EDITAR ASSINAR TRAMITAR ADMINISTRAR ANONIMIZAR       tudo: membros, setores, configuração, logs,
//                 (+ ADMINISTRAR em todo documento/pasta; NÃO vê            exportação, pastas, marcadores, tipos
//                 documento SIGILOSO sem ACL explícita – decisão do dono)
//   GED_GESTOR    idem (valem só onde houver ACL/posse/ADMINISTRAR)         pastas, marcadores, tipos, setores, ACL do que
//                                                                           administra, solicitar assinatura, criar documento
//   GED_USUARIO   VER EDITAR ASSINAR TRAMITAR                               criar documento, solicitar assinatura
//   GED_LEITOR    VER ASSINAR (pode ser signatário)                         –
//   GED_AUDITOR   VER (somente via ACL)                                     ler logs (acesso, comunicação, auditoria)
//
// Observação: GED_USUARIO nunca tem ADMINISTRAR (nem como criador): quem precisa gerir permissões é Gestor/Admin.
import type { GedAcao, GedPapel } from "@prisma/client";
import type { CtxGed } from "./escopo";

/** Teto de ações por papel (ver tabela acima). */
export const TETO_ACOES: Record<GedPapel, readonly GedAcao[]> = {
  GED_ADMIN: ["VER", "EDITAR", "ASSINAR", "TRAMITAR", "ADMINISTRAR", "ANONIMIZAR"],
  GED_GESTOR: ["VER", "EDITAR", "ASSINAR", "TRAMITAR", "ADMINISTRAR", "ANONIMIZAR"],
  GED_USUARIO: ["VER", "EDITAR", "ASSINAR", "TRAMITAR"],
  GED_LEITOR: ["VER", "ASSINAR"],
  GED_AUDITOR: ["VER"],
};

export function tetoDoPapel(papel: GedPapel): ReadonlySet<GedAcao> {
  return new Set(TETO_ACOES[papel]);
}

/** Capacidades administrativas (não ligadas a um documento específico). */
export type CapacidadeGed =
  | "membros" // criar/editar membros e papéis
  | "config" // configuração do cliente (prazos, canal, retenção, certificado)
  | "setores" // CRUD de setores e participantes
  | "exportacao" // exportação completa dos dados do cliente
  | "logs" // consultar logs de acesso/alteração/comunicação
  | "pastas" // criar/mover/renomear pastas
  | "marcadores" // criar/editar marcadores
  | "tipos" // criar/editar tipos de documento
  | "criar_documento" // criar/enviar documentos
  | "solicitar_assinatura" // abrir solicitação de assinatura (além de EDITAR no documento)
  | "importar"; // importação em lote de ZIP (cria pastas e documentos em massa)

export const CAPACIDADES_POR_PAPEL: Record<CapacidadeGed, readonly GedPapel[]> = {
  membros: ["GED_ADMIN"],
  config: ["GED_ADMIN"],
  exportacao: ["GED_ADMIN"],
  setores: ["GED_ADMIN", "GED_GESTOR"],
  pastas: ["GED_ADMIN", "GED_GESTOR"],
  marcadores: ["GED_ADMIN", "GED_GESTOR"],
  tipos: ["GED_ADMIN", "GED_GESTOR"],
  logs: ["GED_ADMIN", "GED_AUDITOR"],
  criar_documento: ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"],
  solicitar_assinatura: ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"],
  importar: ["GED_ADMIN", "GED_GESTOR"],
};

type ComPapel = { membro: Pick<CtxGed["membro"], "papel"> };

export const papelTem = (papel: GedPapel, cap: CapacidadeGed) => CAPACIDADES_POR_PAPEL[cap].includes(papel);

/** O membro possui a capacidade administrativa? */
export const podeGed = (ctx: ComPapel, cap: CapacidadeGed) => papelTem(ctx.membro.papel, cap);

/** Administrador do cliente no GED (membros, configuração, exportação…). */
export const podeAdministrarGed = (ctx: ComPapel) => ctx.membro.papel === "GED_ADMIN";
/** Admin ou Gestor: estrutura (setores, pastas, marcadores, tipos). */
export const podeGerirEstruturaGed = (ctx: ComPapel) => ctx.membro.papel === "GED_ADMIN" || ctx.membro.papel === "GED_GESTOR";
/** Pode consultar os logs do módulo (Admin e Auditor). */
export const podeVerLogs = (ctx: ComPapel) => podeGed(ctx, "logs");
export const podeCriarDocumento = (ctx: ComPapel) => podeGed(ctx, "criar_documento");
/** Importação em lote de ZIP (Admin e Gestor). */
export const podeImportarGed = (ctx: ComPapel) => podeGed(ctx, "importar");
export const podeSolicitarAssinatura = (ctx: ComPapel) => podeGed(ctx, "solicitar_assinatura");
/** Somente leitura de fato (Leitor/Auditor): esconda botões de escrita. */
export const isSomenteLeituraGed = (ctx: ComPapel) => ctx.membro.papel === "GED_LEITOR" || ctx.membro.papel === "GED_AUDITOR";
