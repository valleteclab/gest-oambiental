// CONTRATO do módulo de documentos oficiais (SPEC 7). Implementação: lib/documentos/emitir.ts
// Usado por: processo (recibo, parecer, licença, ofício de indeferimento) e fiscalização (auto, notificação).
import type { DocumentoOficial, TipoDocumento } from "@prisma/client";
import type { UsuarioSessao } from "../rbac";

export type EmitirInput = {
  tipo: TipoDocumento;
  municipio_id: string;
  processo_id?: string | null;
  fiscalizacao_id?: string | null;
  titular_id?: string | null; // pessoa titular/autuado/notificado
  /** Sigla do tipo de ato (LO, LP…) – usada na numeração de LICENCA/AUTORIZACAO/CERTIDAO */
  sigla_ato?: string | null;
  /** Número já gerado (ex.: auto de infração/notificação/parecer numerados pelo módulo de origem). Se ausente, é gerado. */
  numero?: string | null;
  validade_ate?: Date | null;
  /** Variáveis específicas do modelo (condicionantes, texto do parecer, infração, exigência etc.) */
  dados: Record<string, unknown>;
  usuario: UsuarioSessao;
};

export type { DocumentoOficial };
export { emitirDocumento, cancelarDocumento, urlValidacao } from "./emitir";
