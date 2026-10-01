import { NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, paginacao, rota } from "@/lib/http";
import { listarMeusAlertas, marcarTodosLidos } from "@/lib/alertas/consultas";

// GET /api/v1/alertas?page=&size=&nao_lidos=1 – alertas do usuário autenticado (não lidos primeiro)
export const GET = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const url = new URL(req.url);
  const { page, size, skip, take } = paginacao(url);
  const r = await listarMeusAlertas(u.id, { skip, take, somenteNaoLidos: url.searchParams.get("nao_lidos") === "1" });
  return NextResponse.json({ data: r.itens, page, size, total: r.total, nao_lidos: r.naoLidos });
});

// POST /api/v1/alertas – { acao: "marcar_todos_lidos" }
export const POST = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const body = (await req.json().catch(() => ({}))) as { acao?: string };
  if (body.acao !== "marcar_todos_lidos") return NextResponse.json({ code: "INVALIDO", message: "Ação inválida.", details: null }, { status: 422 });
  const n = await marcarTodosLidos(u.id);
  return NextResponse.json({ ok: true, marcados: n });
});
