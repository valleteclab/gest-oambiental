import { NextResponse } from "next/server";
import { z } from "zod";
import { rota } from "@/lib/http";
import { conectarCanal, desvincularCanal, obterConfigCanal, salvarCanal, statusCanal, testarCanal, vincularCanal } from "@/lib/ged/admin/canal";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };
const id = z.string().uuid();

// GET → canais de envio do cliente (segredos nunca vão; só o nome dos definidos). Somente GED_ADMIN.
export const GET = rota(async () => NextResponse.json(await obterConfigCanal(await ctxGedApi()), { headers: NO_STORE }));

const Acao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("salvar") }).passthrough(),
  z.object({ acao: z.literal("vincular"), canal_id: id }),
  z.object({ acao: z.literal("desvincular") }),
  z.object({ acao: z.literal("conectar"), canal_id: id }),
  z.object({ acao: z.literal("status"), canal_id: id }),
  z.object({ acao: z.literal("testar"), canal_id: id }),
]);

// POST {acao: salvar|vincular|desvincular|conectar|status|testar, …}
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json();
  const a = Acao.parse(corpo);
  if (a.acao === "salvar") return NextResponse.json(await salvarCanal(ctx, corpo), { status: 201, headers: NO_STORE });
  if (a.acao === "vincular") await vincularCanal(ctx, a.canal_id);
  else if (a.acao === "desvincular") await desvincularCanal(ctx);
  else if (a.acao === "conectar") return NextResponse.json(await conectarCanal(ctx, a.canal_id), { headers: NO_STORE });
  else if (a.acao === "status") return NextResponse.json(await statusCanal(ctx, a.canal_id), { headers: NO_STORE });
  else return NextResponse.json(await testarCanal(ctx, a.canal_id), { headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
});
