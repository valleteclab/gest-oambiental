// Utilitários de Server Actions do GED: converte erros de serviço (ErroApi, ZodError) em estado de formulário.
// As Server Actions DEVEM chamar ctxGedApi() (checar sessão/módulo/papel de novo) e os serviços checam permissão por conta própria.
import { ZodError } from "zod";
import { ErroApi } from "@/lib/http";

export type EstadoFormGed = { ok?: boolean; erro?: string; mensagem?: string } | undefined;

/** Executa `fn` e devolve `{ok, mensagem}` ou `{erro}` (nunca lança erro esperado de negócio/validação/permissão). */
export async function comoEstadoForm(fn: () => Promise<string | void>): Promise<EstadoFormGed> {
  try {
    const mensagem = await fn();
    return { ok: true, mensagem: mensagem || undefined };
  } catch (e) {
    if (e instanceof ErroApi) return { erro: e.status === 404 ? "Registro não encontrado." : e.message };
    if (e instanceof ZodError) return { erro: e.issues[0]?.message ?? "Dados inválidos." };
    // Erros inesperados do Next (redirect/notFound) devem propagar.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { erro: "Não foi possível concluir a operação." };
  }
}
