// Tipos, constantes e rótulos (pt-BR) compartilhados do módulo GED – sem acesso a banco (seguro em componentes cliente).
import { z } from "zod";
import type {
  GedAcao,
  GedOrigemVersao,
  GedPapel,
  GedPrincipalTipo,
  GedSensibilidade,
  GedStatusAssinante,
  GedStatusDocumento,
  GedStatusSolicitacao,
  GedTipoTramite,
} from "@prisma/client";

export type {
  GedAcao,
  GedOrigemVersao,
  GedPapel,
  GedPrincipalTipo,
  GedSensibilidade,
  GedStatusAssinante,
  GedStatusDocumento,
  GedStatusSolicitacao,
  GedTipoTramite,
};

/** Nome do módulo exibido ao cliente. */
export const NOME_MODULO_GED = "Gestão de Documentos";

// ───────────── Listas (ordem de exibição) ─────────────

export const ACOES_GED: readonly GedAcao[] = ["VER", "EDITAR", "ASSINAR", "TRAMITAR", "ADMINISTRAR", "ANONIMIZAR"];
export const PAPEIS_GED: readonly GedPapel[] = ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO", "GED_LEITOR", "GED_AUDITOR"];
export const SENSIBILIDADES_GED: readonly GedSensibilidade[] = ["PUBLICO", "RESTRITO", "SIGILOSO"];

// ───────────── Rótulos ─────────────

export const ROTULO_PAPEL_GED: Record<GedPapel, string> = {
  GED_ADMIN: "Administrador",
  GED_GESTOR: "Gestor",
  GED_USUARIO: "Usuário",
  GED_LEITOR: "Leitor",
  GED_AUDITOR: "Auditor",
};

export const ROTULO_ACAO_GED: Record<GedAcao, string> = {
  VER: "Visualizar",
  EDITAR: "Editar",
  ASSINAR: "Assinar",
  TRAMITAR: "Tramitar",
  ADMINISTRAR: "Administrar",
  ANONIMIZAR: "Anonimizar",
};

export const DESCRICAO_ACAO_GED: Record<GedAcao, string> = {
  VER: "Ver o documento, seus arquivos e o histórico.",
  EDITAR: "Alterar dados e criar novas versões (implica visualizar).",
  ASSINAR: "Assinar quando incluído como signatário (implica visualizar).",
  TRAMITAR: "Enviar a outros usuários ou setores (implica visualizar).",
  ADMINISTRAR: "Gerenciar permissões, mover e arquivar.",
  ANONIMIZAR: "Gerar versão anonimizada para divulgação.",
};

export const ROTULO_STATUS_DOCUMENTO_GED: Record<GedStatusDocumento, string> = {
  RASCUNHO: "Rascunho",
  PUBLICADO: "Publicado",
  EM_ASSINATURA: "Em assinatura",
  ASSINADO: "Assinado",
  RECUSADO: "Recusado",
  ARQUIVADO: "Arquivado",
};

export const ROTULO_SENSIBILIDADE_GED: Record<GedSensibilidade, string> = {
  PUBLICO: "Público",
  RESTRITO: "Restrito",
  SIGILOSO: "Sigiloso",
};

export const ROTULO_ORIGEM_VERSAO_GED: Record<GedOrigemVersao, string> = {
  UPLOAD: "Envio de arquivo",
  EDITOR: "Editor de texto",
  SCAN: "Digitalização",
  OCR: "Reconhecimento de texto (OCR)",
  ANONIMIZACAO: "Anonimização",
  SELO: "Selo de assinatura",
};

export const ROTULO_TIPO_TRAMITE_GED: Record<GedTipoTramite, string> = {
  ENVIO: "Envio",
  DESPACHO: "Despacho",
  CIENCIA: "Ciência",
  DEVOLUCAO: "Devolução",
  RECUSA: "Recusa",
  ARQUIVAMENTO: "Arquivamento",
};

export const ROTULO_STATUS_SOLICITACAO_GED: Record<GedStatusSolicitacao, string> = {
  ABERTA: "Aberta",
  CONCLUIDA: "Concluída",
  RECUSADA: "Recusada",
  CANCELADA: "Cancelada",
  EXPIRADA: "Expirada",
};

export const ROTULO_STATUS_ASSINANTE_GED: Record<GedStatusAssinante, string> = {
  AGUARDANDO: "Aguardando a vez",
  PENDENTE: "Pendente",
  ASSINADO: "Assinado",
  RECUSADO: "Recusado",
  EXPIRADO: "Expirado",
};

export const ROTULO_PRINCIPAL_GED: Record<GedPrincipalTipo, string> = { USUARIO: "Usuário", SETOR: "Setor" };

/** Cor de selo (Badge de components/ui.tsx) por status de documento. */
export const COR_STATUS_DOCUMENTO_GED: Record<GedStatusDocumento, "verde" | "amarelo" | "vermelho" | "azul" | "cinza" | "roxo"> = {
  RASCUNHO: "cinza",
  PUBLICADO: "azul",
  EM_ASSINATURA: "amarelo",
  ASSINADO: "verde",
  RECUSADO: "vermelho",
  ARQUIVADO: "cinza",
};

// ───────────── Alvo e principal de permissão ─────────────

/** Recurso ao qual uma ACL se aplica. */
export type AlvoAcl = { tipo: "pasta"; id: string } | { tipo: "documento"; id: string };
/** Quem recebe a permissão. */
export type PrincipalAcl = { tipo: "USUARIO"; id: string } | { tipo: "SETOR"; id: string };

// ───────────── Zod (entradas comuns) ─────────────

export const zUuid = z.string().uuid();
export const zAcao = z.enum(["VER", "EDITAR", "ASSINAR", "TRAMITAR", "ADMINISTRAR", "ANONIMIZAR"]);
export const zSensibilidade = z.enum(["PUBLICO", "RESTRITO", "SIGILOSO"]);
export const zPapelGed = z.enum(["GED_ADMIN", "GED_GESTOR", "GED_USUARIO", "GED_LEITOR", "GED_AUDITOR"]);

export const zAlvoAcl = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("pasta"), id: zUuid }),
  z.object({ tipo: z.literal("documento"), id: zUuid }),
]);
export const zPrincipalAcl = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("USUARIO"), id: zUuid }),
  z.object({ tipo: z.literal("SETOR"), id: zUuid }),
]);

export const zConcederAcl = z.object({
  alvo: zAlvoAcl,
  principal: zPrincipalAcl,
  acoes: z.array(zAcao).min(1, "Escolha ao menos uma ação.").max(6),
  /** ISO 8601; vazio = não expira. */
  expira_em: z.union([z.string().datetime({ offset: true }), z.string().date(), z.null()]).optional(),
});
export type EntradaConcederAcl = z.infer<typeof zConcederAcl>;

export const zSetor = z.object({
  nome: z.string().trim().min(2, "Informe o nome do setor.").max(120),
  sigla: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, "Sigla: 2 a 12 letras, números ou hífen."),
});
export type EntradaSetor = z.infer<typeof zSetor>;
