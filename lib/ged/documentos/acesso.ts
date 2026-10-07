// Ponto único para registrar acessos (VISUALIZAR/BAIXAR/BUSCAR/LISTAR/NEGADO) a partir da frente B.
// Envolve `registrarAcesso` (frente E): enquanto o esqueleto lança "não implementado" o erro é ignorado; qualquer falha
// de log NUNCA derruba a requisição do usuário (o acesso já foi autorizado/negado antes).
import { registrarAcesso } from "../logs/acesso";
import type { AcaoAcessoGed, CtxGed, RegistrarAcessoInput } from "../contratos";

export async function registrarAcessoSeguro(ctx: CtxGed, acao: AcaoAcessoGed, input?: RegistrarAcessoInput): Promise<void> {
  try {
    await registrarAcesso(ctx, acao, input);
  } catch (e) {
    if (e instanceof Error && e.message === "não implementado") return;
    console.error("[ged] falha ao registrar acesso", acao, e instanceof Error ? e.message : e);
  }
}

/**
 * Acesso NEGADO: só informa o documento_id quando o documento pertence ao cliente do contexto. O chamador passa o id
 * que veio da URL; como a consulta é escopada, um id de outro cliente nunca chega aqui com `existeNoTenant=true`.
 */
export function registrarNegado(ctx: CtxGed, documentoId: string | null, existeNoTenant: boolean): Promise<void> {
  return registrarAcessoSeguro(ctx, "NEGADO", existeNoTenant && documentoId ? { documento_id: documentoId } : undefined);
}
