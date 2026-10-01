import { NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, proibido, rota } from "@/lib/http";
import { can } from "@/lib/rbac";
import { calcularIndicadores } from "@/lib/indicadores/calcular";
import { lerFiltros, municipioPermitido } from "@/lib/indicadores/filtros";

export const dynamic = "force-dynamic";

/** GET /api/v1/indicadores?municipio=&de=&ate=&tipo_ato=&tecnico= – indicadores do painel (SPEC 11/12). */
export const GET = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!can(u, "ver", "dashboard")) throw proibido();
  const filtros = lerFiltros(new URL(req.url).searchParams);
  if (!municipioPermitido(u, filtros)) throw proibido("Município fora do seu escopo.");
  return NextResponse.json(await calcularIndicadores(u, filtros));
});
