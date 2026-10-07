// Chama notificar() (frente E) ignorando SOMENTE o erro do esqueleto ("não implementado"); qualquer outro erro propaga.
import { notificar } from "../notificar";
import type { CtxGed, EventoGed, GedTx, NotificarInput } from "../contratos";

export async function notificarSePossivel(tx: GedTx, ctx: CtxGed, evento: EventoGed, input: NotificarInput): Promise<void> {
  if (input.usuario_ids.length === 0) return;
  try {
    await notificar(tx, ctx, evento, input);
  } catch (e) {
    if (e instanceof Error && e.message === "não implementado") return;
    throw e;
  }
}
