import "server-only";
import type { DocumentoOficial } from "@prisma/client";
import { prisma } from "../db";
import { can, isInterno, type UsuarioSessao } from "../rbac";
import { statusPublico, TIPOS_PUBLICOS } from "./render";

/**
 * Quem pode baixar o PDF de um documento oficial:
 *  - interno com `ver documento` no município do documento;
 *  - requerente titular do documento, ou requerente/RT do processo;
 *  - qualquer pessoa (anônimo) se for licença/autorização/certidão VÁLIDA (transparência).
 */
export async function podeBaixarDocumento(u: UsuarioSessao | null, doc: Pick<DocumentoOficial, "municipio_id" | "titular_id" | "processo_id" | "tipo" | "status" | "validade_ate">): Promise<boolean> {
  if ((TIPOS_PUBLICOS as readonly string[]).includes(doc.tipo) && statusPublico(doc) === "VALIDO") return true;
  if (!u) return false;
  if (isInterno(u)) return can(u, "ver", "documento", doc.municipio_id);
  if (!u.pessoa_id) return false;
  if (doc.titular_id === u.pessoa_id) return true;
  if (!doc.processo_id) return false;
  const p = await prisma.processo.findUnique({ where: { id: doc.processo_id }, select: { requerente_id: true, rt: { select: { pessoa_id: true } } } });
  return !!p && (p.requerente_id === u.pessoa_id || p.rt?.pessoa_id === u.pessoa_id);
}

/** Nome de arquivo amigável: "LO-ITB-001-2026.pdf" */
export const nomeArquivoPdf = (numero: string) => `${numero.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
