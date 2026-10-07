import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { listarExclusoes } from "@/lib/ged/exclusao/servico";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/exclusoes – exclusões do cliente (Admin: todas; Gestor: as suas), mais recentes primeiro.
export const GET = rota(async () => NextResponse.json({ itens: await listarExclusoes(await ctxGedApi()) }));
