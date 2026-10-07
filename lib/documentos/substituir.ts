import "server-only";
import type { DocumentoOficial } from "@prisma/client";
import { prisma } from "../db";
import { invalido, naoEncontrado, proibido } from "../http";
import { can, isSomenteLeitura, type UsuarioSessao } from "../rbac";
import { cancelarDocumento, emitirDocumento } from "./emitir";

/**
 * Correção de documento emitido (SPEC 7.4): emite um SUBSTITUTO com os mesmos parâmetros e os dados cadastrais ATUAIS
 * (ex.: após corrigir o cadastro do titular) e marca o original como SUBSTITUIDO, com motivo.
 */
export async function substituirDocumento(id: string, motivo: string, usuario: UsuarioSessao, ajustes: { validade_ate?: Date | null } = {}): Promise<DocumentoOficial> {
  if ((motivo ?? "").trim().length < 5) throw invalido("Informe o motivo da substituição (mínimo de 5 caracteres).");
  const orig = await prisma.documentoOficial.findUnique({ where: { id } });
  if (!orig) throw naoEncontrado("Documento não encontrado.");
  if (isSomenteLeitura(usuario) || !can(usuario, "cancelar_documento", "documento", orig.municipio_id) || !can(usuario, "emitir_documento", "documento", orig.municipio_id))
    throw proibido("Sem permissão para substituir documentos deste município.");
  if (orig.status !== "VALIDO") throw invalido("Somente documentos válidos podem ser substituídos.");
  const { _contexto, ...dadosOriginais } = (orig.dados ?? {}) as Record<string, unknown>;
  void _contexto;
  const novo = await emitirDocumento({
    tipo: orig.tipo,
    municipio_id: orig.municipio_id,
    processo_id: orig.processo_id,
    fiscalizacao_id: orig.fiscalizacao_id,
    titular_id: orig.titular_id,
    sigla_ato: orig.sigla_ato,
    validade_ate: ajustes.validade_ate !== undefined ? ajustes.validade_ate : orig.validade_ate,
    dados: { ...dadosOriginais, substitui_documento_id: orig.id, substitui_numero: orig.numero },
    usuario,
  });
  await cancelarDocumento(orig.id, motivo, usuario, novo.id);
  return novo;
}
