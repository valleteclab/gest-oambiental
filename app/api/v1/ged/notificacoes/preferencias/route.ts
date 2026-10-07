import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { lerPreferencias, salvarPreferencias } from "@/lib/ged/notificar/preferencias";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/notificacoes/preferencias – preferências do próprio usuário (padrão: e-mail ligado, WhatsApp desligado)
export const GET = rota(async () => NextResponse.json({ itens: await lerPreferencias(await ctxGedApi()) }, { headers: { "Cache-Control": "private, no-store" } }));

// PUT /api/v1/ged/notificacoes/preferencias  [{evento, email, whatsapp}]
export const PUT = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = (await req.json()) as { itens?: unknown } | unknown[];
  await salvarPreferencias(ctx, Array.isArray(corpo) ? corpo : corpo.itens);
  return NextResponse.json({ itens: await lerPreferencias(ctx) });
});
