// STUB – será implementado pelo módulo de Documentos Oficiais.
import type { DocumentoOficial } from "@prisma/client";
import type { EmitirInput } from "./index";
import type { UsuarioSessao } from "../rbac";

/** Renderiza modelo HTML → PDF (com QR + código verificador), grava no storage e cria documento_oficial. */
export async function emitirDocumento(_input: EmitirInput): Promise<DocumentoOficial> {
  throw new Error("emitirDocumento ainda não implementado");
}

/** Cancela (status CANCELADO ou SUBSTITUIDO quando substitutoId informado) com motivo obrigatório. */
export async function cancelarDocumento(_id: string, _motivo: string, _usuario: UsuarioSessao, _substitutoId?: string): Promise<DocumentoOficial> {
  throw new Error("cancelarDocumento ainda não implementado");
}

export function urlValidacao(codigo: string): string {
  return `${process.env.APP_URL ?? "http://localhost:3000"}/validar/${codigo}`;
}
