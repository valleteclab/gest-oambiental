// ESQUELETO (frente A): a frente C substitui este arquivo mantendo a assinatura exportada.
/* eslint-disable @typescript-eslint/no-unused-vars -- esqueleto: parâmetros ainda não usados */
import type { CtxGed, GedTx, RegistrarComentarioInput } from "../contratos";

/** Registra um comentário (append-only) no documento. */
export async function registrarComentario(_tx: GedTx, _ctx: CtxGed, _input: RegistrarComentarioInput): Promise<{ id: string }> {
  throw new Error("não implementado");
}
