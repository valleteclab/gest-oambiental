import { NextResponse } from "next/server";
import { ZodError } from "zod";

// Erros da API no formato {code, message, details} (SPEC 12)
export class ErroApi extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const naoAutenticado = () => new ErroApi(401, "NAO_AUTENTICADO", "Autenticação necessária.");
export const proibido = (msg = "Acesso negado.") => new ErroApi(403, "PROIBIDO", msg);
export const naoEncontrado = (msg = "Registro não encontrado.") => new ErroApi(404, "NAO_ENCONTRADO", msg);
export const invalido = (msg: string, details?: unknown) => new ErroApi(422, "INVALIDO", msg, details);

export function respostaErro(e: unknown) {
  if (e instanceof ErroApi) return NextResponse.json({ code: e.code, message: e.message, details: e.details ?? null }, { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ code: "INVALIDO", message: "Dados inválidos.", details: e.issues }, { status: 422 });
  console.error(e);
  return NextResponse.json({ code: "ERRO_INTERNO", message: "Erro interno." }, { status: 500 });
}

/** Envolve um handler de rota tratando erros no formato padrão. */
export function rota<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return respostaErro(e);
    }
  };
}

export function paginacao(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const size = Math.min(200, Math.max(1, Number(url.searchParams.get("size") ?? 20)));
  return { page, size, skip: (page - 1) * size, take: size };
}
