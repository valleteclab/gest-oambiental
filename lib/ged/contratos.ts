// Contratos entre frentes do GED (docs/ged-design.md §10). Cada frente IMPLEMENTA o serviço do seu arquivo
// mantendo exatamente estas assinaturas; as demais frentes só importam daqui os TIPOS e dos arquivos as funções.
//
//   criarVersao ........ lib/ged/documentos/versoes.ts      (frente B)
//   registrarTramite ... lib/ged/tramite/servico.ts         (frente C)
//   registrarComentario  lib/ged/comentarios/servico.ts     (frente C)
//   notificar .......... lib/ged/notificar/index.ts         (frente E)
//   registrarAcesso .... lib/ged/logs/acesso.ts            (frente E)
//   podeNoDocumento .... lib/ged/permissoes.ts              (frente A – pronto)
//
// Regras comuns: `tx` é o cliente transacional ESCOPADO (`ctx.db.$transaction(async (tx) => …)`); o serviço NÃO abre
// transação própria, NÃO verifica permissão (quem chama já verificou com exigirDocumento/podeNoDocumento) e audita via auditarGed().
import type { GedOrigemVersao, GedTipoTramite } from "@prisma/client";
import type { GedTx } from "./db";
import type { CtxGed } from "./escopo";

export type { GedTx } from "./db";
export type { CtxGed } from "./escopo";
export type { GedDocumentoMin } from "./permissoes";

// ── B: versões ──
export type CriarVersaoInput = {
  documento_id: string;
  origem: GedOrigemVersao;
  arquivo: Buffer;
  nome_arquivo: string;
  mime: string;
  conteudo_html?: string | null;
  selada?: boolean;
  derivada_de_id?: string | null;
};
export type CriarVersaoResultado = { id: string; n: number; sha256: string; storage_key: string };
export type CriarVersaoFn = (tx: GedTx, ctx: CtxGed, input: CriarVersaoInput) => Promise<CriarVersaoResultado>;

// ── C: trâmite e comentários ──
export type RegistrarTramiteInput = {
  documento_id: string;
  tipo: GedTipoTramite;
  para_usuario_id?: string;
  para_setor_id?: string;
  despacho?: string;
  prazo_em?: Date;
  referencia_id?: string;
};
export type RegistrarTramiteFn = (tx: GedTx, ctx: CtxGed, input: RegistrarTramiteInput) => Promise<{ id: string }>;

export type ContextoComentario = "GERAL" | "ASSINATURA" | "RECUSA" | "TRAMITE";
export type RegistrarComentarioInput = {
  documento_id: string;
  versao_id?: string;
  solicitacao_id?: string;
  contexto: ContextoComentario;
  texto: string;
};
export type RegistrarComentarioFn = (tx: GedTx, ctx: CtxGed, input: RegistrarComentarioInput) => Promise<{ id: string }>;

// ── E: notificações e logs de acesso ──
export type EventoGed =
  | "TRAMITE_RECEBIDO"
  | "ASSINATURA_SOLICITADA"
  | "ASSINATURA_CONCLUIDA"
  | "ASSINATURA_RECUSADA"
  | "ASSINATURA_LEMBRETE"
  | "ASSINATURA_EXPIRADA"
  | "DOCUMENTO_COMPARTILHADO";
export type NotificarInput = { usuario_ids: string[]; documento_id?: string; assinante_id?: string; dados?: Record<string, string> };
/** Grava as linhas da outbox (GedComunicacao PENDENTE) na transação do chamador; o envio é feito pelo job ged-notificar. */
export type NotificarFn = (tx: GedTx, ctx: CtxGed, evento: EventoGed, input: NotificarInput) => Promise<void>;

export type AcaoAcessoGed = "VISUALIZAR" | "BAIXAR" | "BUSCAR" | "LISTAR" | "NEGADO" | "LOGIN_GED";
export type RegistrarAcessoInput = { documento_id?: string; versao_id?: string };
export type RegistrarAcessoFn = (ctx: CtxGed, acao: AcaoAcessoGed, input?: RegistrarAcessoInput) => Promise<void>;
