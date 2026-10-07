import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarPasta, listarPastas } from "@/lib/ged/pastas";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/pastas – pastas visíveis (lista plana com parent_id; contagem de documentos visíveis)
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const incluirArquivadas = new URL(req.url).searchParams.get("arquivadas") === "1";
  return NextResponse.json({ data: await listarPastas(ctx, { incluirArquivadas }) });
});

// POST /api/v1/ged/pastas – { nome, parent_id?, sensibilidade_padrao? }
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const c = (await req.json().catch(() => ({}))) as { nome?: string; parent_id?: string | null; sensibilidade_padrao?: never };
  return NextResponse.json(await criarPasta(ctx, { nome: c.nome ?? "", parent_id: c.parent_id, sensibilidade_padrao: c.sensibilidade_padrao }), { status: 201 });
});
