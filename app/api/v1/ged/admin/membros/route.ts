import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { criarMembro, listarMembros } from "@/lib/ged/admin/membros";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

// GET → membros do cliente (somente GED_ADMIN)
export const GET = rota(async () => NextResponse.json({ itens: await listarMembros(await ctxGedApi()) }, { headers: NO_STORE }));

// POST {nome, email, cargo?, papel, setor_ids?} → cria Usuario (desta organização) + membro; devolve a senha provisória UMA vez
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const r = await criarMembro(ctx, await req.json());
  return NextResponse.json(r, { status: 201, headers: NO_STORE });
});
