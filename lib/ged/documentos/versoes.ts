// ESQUELETO (frente A): a frente B substitui este arquivo mantendo a assinatura exportada.
/* eslint-disable @typescript-eslint/no-unused-vars -- esqueleto: parâmetros ainda não usados */
import type { CriarVersaoInput, CriarVersaoResultado, CtxGed, GedTx } from "../contratos";

/** Cria uma nova versão do documento (grava o arquivo, calcula sha256, numera `n`, atualiza `versao_atual_id`). */
export async function criarVersao(_tx: GedTx, _ctx: CtxGed, _input: CriarVersaoInput): Promise<CriarVersaoResultado> {
  throw new Error("não implementado");
}
