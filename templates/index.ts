// Modelos embutidos de documentos oficiais (SPEC 7.6). Usados quando não há `modelo_documento` ativo para o tipo.
// Funções TS (e não arquivos .html) para funcionarem no output standalone do `next build`.
import { renderAutoInfracao } from "./auto-infracao";
import { renderCertidao } from "./certidao";
import { renderLicenca } from "./licenca";
import { renderNotificacao } from "./notificacao";
import { renderOficio } from "./oficio";
import { renderParecer } from "./parecer";
import { renderRecibo } from "./recibo";
import { renderAutorizacaoPoda } from "./autorizacao-poda";
import { renderAutorizacaoSom } from "./autorizacao-som";
import type { ContextoDocumento, TipoDoc } from "./tipos";

export type { ContextoDocumento, TipoDoc };
export { pagina, rodape, BRASAO_GENERICO_URI } from "./base";
export { listaCondicionantes } from "./licenca";

export const MODELOS: Record<TipoDoc, (ctx: ContextoDocumento) => string> = {
  LICENCA: renderLicenca,
  AUTORIZACAO: renderLicenca,
  CERTIDAO: renderCertidao,
  PARECER: renderParecer,
  AUTO_INFRACAO: renderAutoInfracao,
  NOTIFICACAO: renderNotificacao,
  OFICIO: renderOficio,
  RECIBO: renderRecibo,
};

export const TITULO_PADRAO: Record<TipoDoc, string> = {
  LICENCA: "Licença Ambiental",
  AUTORIZACAO: "Autorização Ambiental",
  CERTIDAO: "Certidão Ambiental",
  PARECER: "Parecer Técnico",
  AUTO_INFRACAO: "Auto de Infração Ambiental",
  NOTIFICACAO: "Notificação Ambiental",
  OFICIO: "Ofício",
  RECIBO: "Recibo de Protocolo",
};

/**
 * Modelos embutidos ESPECÍFICOS de um tipo de ato (demandas urbanas). Resolução (lib/documentos/modelo.ts):
 *   1) tipo_ato.modelo_documento = chave abaixo (editável em /admin/tipos-ato);
 *   2) senão, AUTORIZACAO com sigla APC → poda; ASE/ACS → som.
 * Têm precedência sobre o modelo_documento genérico de AUTORIZACAO (que não traz compensação, dB, placa…).
 */
export const MODELOS_ESPECIFICOS: Record<string, (ctx: ContextoDocumento) => string> = {
  AUTORIZACAO_PODA: renderAutorizacaoPoda,
  AUTORIZACAO_SOM: renderAutorizacaoSom,
};
const MODELO_POR_SIGLA: Record<string, string> = { APC: "AUTORIZACAO_PODA", ASE: "AUTORIZACAO_SOM", ACS: "AUTORIZACAO_SOM" };

/** Chave do modelo específico aplicável ao documento (null = modelo geral do tipo). */
export function chaveModeloEspecifico(ctx: Pick<ContextoDocumento, "tipo" | "modelo_ato" | "processo">): string | null {
  if (ctx.tipo !== "AUTORIZACAO") return null;
  if (ctx.modelo_ato && ctx.modelo_ato in MODELOS_ESPECIFICOS) return ctx.modelo_ato;
  return MODELO_POR_SIGLA[ctx.processo?.tipo_ato_sigla ?? ""] ?? null;
}
