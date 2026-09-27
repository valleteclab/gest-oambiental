// Modelos embutidos de documentos oficiais (SPEC 7.6). Usados quando não há `modelo_documento` ativo para o tipo.
// Funções TS (e não arquivos .html) para funcionarem no output standalone do `next build`.
import { renderAutoInfracao } from "./auto-infracao";
import { renderCertidao } from "./certidao";
import { renderLicenca } from "./licenca";
import { renderNotificacao } from "./notificacao";
import { renderOficio } from "./oficio";
import { renderParecer } from "./parecer";
import { renderRecibo } from "./recibo";
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
