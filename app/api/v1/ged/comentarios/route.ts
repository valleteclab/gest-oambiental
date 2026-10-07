import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { comentar, listarComentarios } from "@/lib/ged/comentarios/servico";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/comentarios?documento_id=…  → { itens } (exige VER; 404 sem acesso/outro cliente)
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const id = new URL(req.url).searchParams.get("documento_id") ?? "";
  if (!z.string().uuid().safeParse(id).success) throw invalido("documento_id inválido.");
  return NextResponse.json({ itens: await listarComentarios(ctx, id) });
});

const zCorpo = z.object({ documento_id: z.string().uuid(), texto: z.string(), contexto: z.enum(["GERAL", "TRAMITE"]).optional() });

// POST /api/v1/ged/comentarios  { documento_id, texto, contexto? }  (exige VER; 429 se exceder o limite de ritmo)
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = zCorpo.parse(await req.json().catch(() => { throw invalido("Corpo JSON inválido."); }));
  return NextResponse.json(await comentar(ctx, corpo), { status: 201 });
});
