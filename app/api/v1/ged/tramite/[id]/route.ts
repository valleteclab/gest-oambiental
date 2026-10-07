import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { arquivarDocumento, darCiencia, despachar, devolver, enviarDocumento } from "@/lib/ged/tramite/acoes";
import { linhaDoTempo } from "@/lib/ged/tramite/consultas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/tramite/{documentoId} → { itens } linha do tempo (exige VER; 404 se sem acesso/outro cliente)
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw invalido("Identificador inválido.");
  return NextResponse.json({ itens: await linhaDoTempo(ctx, id) });
});

const zCorpo = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("ENVIAR"), destino: z.object({ tipo: z.enum(["USUARIO", "SETOR"]), id: z.string().uuid() }), despacho: z.string().optional(), prazo: z.string().optional() }),
  z.object({ acao: z.literal("DESPACHAR"), despacho: z.string() }),
  z.object({ acao: z.literal("CIENCIA"), despacho: z.string().optional() }),
  z.object({ acao: z.literal("DEVOLVER"), despacho: z.string() }),
  z.object({ acao: z.literal("ARQUIVAR"), despacho: z.string().optional() }),
]);

// POST /api/v1/ged/tramite/{documentoId}  { acao: ENVIAR|DESPACHAR|CIENCIA|DEVOLVER|ARQUIVAR, ... } (exige TRAMITAR → 403)
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const corpo = zCorpo.parse(await req.json().catch(() => { throw invalido("Corpo JSON inválido."); }));
  const base = { documento_id: id };
  const r =
    corpo.acao === "ENVIAR" ? await enviarDocumento(ctx, { ...base, destino: corpo.destino, despacho: corpo.despacho, prazo: corpo.prazo })
    : corpo.acao === "DESPACHAR" ? await despachar(ctx, { ...base, despacho: corpo.despacho })
    : corpo.acao === "CIENCIA" ? await darCiencia(ctx, { ...base, despacho: corpo.despacho })
    : corpo.acao === "DEVOLVER" ? await devolver(ctx, { ...base, despacho: corpo.despacho })
    : await arquivarDocumento(ctx, { ...base, despacho: corpo.despacho });
  return NextResponse.json(r, { status: 201 });
});
