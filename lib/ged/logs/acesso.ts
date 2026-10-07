// ESQUELETO (frente A): a frente E substitui este arquivo mantendo a assinatura exportada.
/* eslint-disable @typescript-eslint/no-unused-vars -- esqueleto: parâmetros ainda não usados */
import type { AcaoAcessoGed, CtxGed, RegistrarAcessoInput } from "../contratos";

/** Registra um acesso (ip/user-agent via next/headers quando houver). Em NEGADO nunca grava documento_id de outro cliente. */
export async function registrarAcesso(_ctx: CtxGed, _acao: AcaoAcessoGed, _input?: RegistrarAcessoInput): Promise<void> {
  throw new Error("não implementado");
}
