// ESQUELETO (frente A): a frente C substitui este arquivo mantendo a assinatura exportada.
/* eslint-disable @typescript-eslint/no-unused-vars -- esqueleto: parâmetros ainda não usados */
import type { CtxGed, GedTx, RegistrarTramiteInput } from "../contratos";

/** Registra um trâmite imutável (e atualiza setor_atual_id/responsavel_id do documento). */
export async function registrarTramite(_tx: GedTx, _ctx: CtxGed, _input: RegistrarTramiteInput): Promise<{ id: string }> {
  throw new Error("não implementado");
}
