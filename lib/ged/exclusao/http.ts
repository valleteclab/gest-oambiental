// Adaptação HTTP das rotas de exclusão (corpo JSON ou querystring: `confirmacao`, `apenas_possiveis`).
import { NextResponse } from "next/server";
import type { EntradaExclusao, ResultadoInicio } from "./servico";

export async function lerEntradaExclusao(req: Request): Promise<EntradaExclusao> {
  const url = new URL(req.url);
  const corpo = (await req.json().catch(() => ({}))) as { confirmacao?: unknown; apenas_possiveis?: unknown };
  const q = url.searchParams;
  const apenas = corpo.apenas_possiveis === true || q.get("apenas_possiveis") === "true";
  return { confirmacao: corpo.confirmacao ?? q.get("confirmacao") ?? "", apenas_possiveis: apenas };
}

/** 200 quando já concluiu (pequeno, síncrono); 202 quando segue em segundo plano (acompanhe em /api/v1/ged/exclusoes/{id}). */
export const respostaInicio = (r: ResultadoInicio) => NextResponse.json(r, { status: r.exclusao.status === "CONCLUIDA" ? 200 : 202 });
