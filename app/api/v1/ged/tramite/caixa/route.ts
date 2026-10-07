import { NextResponse } from "next/server";
import { invalido, paginacao, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { aplicarFiltroEntrada, aplicarFiltroEnviados, carregarCaixaEntrada, carregarEnviados, type FiltroEntrada, type FiltroEnviados } from "@/lib/ged/tramite/consultas";
import { resumoTramite } from "@/lib/ged/tramite/resumo";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/tramite/caixa?tipo=entrada|enviados|resumo&filtro=&q=&page=&size=
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? "entrada";
  if (tipo === "resumo") return NextResponse.json(await resumoTramite(ctx));
  if (tipo !== "entrada" && tipo !== "enviados") throw invalido("tipo deve ser entrada, enviados ou resumo.");
  const q = url.searchParams.get("q") ?? undefined;
  const filtro = url.searchParams.get("filtro") ?? "todos";
  const { page, size, skip } = paginacao(url);
  const todos = tipo === "entrada" ? aplicarFiltroEntrada(await carregarCaixaEntrada(ctx, q), filtro as FiltroEntrada) : aplicarFiltroEnviados(await carregarEnviados(ctx, q), filtro as FiltroEnviados);
  return NextResponse.json({ itens: todos.slice(skip, skip + size), total: todos.length, page, size });
});
