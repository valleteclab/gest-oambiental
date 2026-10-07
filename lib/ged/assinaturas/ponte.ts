// Ponte para os serviços das outras frentes (notificar – E; registrarTramite/registrarComentario – C).
// Ignora SOMENTE o erro do esqueleto ("não implementado"); qualquer outro erro propaga.
import type { CtxGed, EventoGed, GedTx, NotificarInput, RegistrarComentarioInput, RegistrarTramiteInput } from "../contratos";
import { registrarComentario } from "../comentarios/servico";
import { notificar } from "../notificar";
import { registrarTramite } from "../tramite/servico";

const ehEsqueleto = (e: unknown) => e instanceof Error && e.message === "não implementado";

/** Evento usado quando uma solicitação é cancelada. */
export const EVENTO_CANCELAMENTO: EventoGed = "ASSINATURA_CANCELADA";

export async function avisar(tx: GedTx, ctx: CtxGed, evento: EventoGed, input: NotificarInput): Promise<void> {
  const ids = [...new Set(input.usuario_ids)];
  if (ids.length === 0) return;
  try {
    await notificar(tx, ctx, evento, { ...input, usuario_ids: ids });
  } catch (e) {
    if (!ehEsqueleto(e)) throw e;
  }
}

export async function comentarioSeguro(tx: GedTx, ctx: CtxGed, input: RegistrarComentarioInput): Promise<{ id: string } | null> {
  try {
    return await registrarComentario(tx, ctx, input);
  } catch (e) {
    if (ehEsqueleto(e)) return null;
    throw e;
  }
}

export async function tramiteSeguro(tx: GedTx, ctx: CtxGed, input: RegistrarTramiteInput): Promise<{ id: string } | null> {
  try {
    return await registrarTramite(tx, ctx, input);
  } catch (e) {
    if (ehEsqueleto(e)) return null;
    throw e;
  }
}
