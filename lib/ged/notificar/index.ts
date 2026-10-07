// ESQUELETO (frente A): a frente E substitui este arquivo mantendo a assinatura exportada.
/* eslint-disable @typescript-eslint/no-unused-vars -- esqueleto: parâmetros ainda não usados */
import type { CtxGed, EventoGed, GedTx, NotificarInput } from "../contratos";

export type { EventoGed };

/** Enfileira notificações (outbox GedComunicacao) na transação do chamador. */
export async function notificar(_tx: GedTx, _ctx: CtxGed, _evento: EventoGed, _input: NotificarInput): Promise<void> {
  throw new Error("não implementado");
}
