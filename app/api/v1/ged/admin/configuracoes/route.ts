import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { lerConfiguracoes, salvarConfiguracoes } from "@/lib/ged/admin/configuracoes";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";

// GET → configurações do cliente (GED_ADMIN)
export const GET = rota(async () => NextResponse.json(await lerConfiguracoes(await ctxGedApi()), { headers: { "Cache-Control": "private, no-store" } }));

// PUT {assinatura_prazo_dias, lembrete_dias: "3, 1, 0", retencao_acesso_log_dias, cota_gb}
export const PUT = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = (await req.json()) as Record<string, unknown>;
  const lembretes = Array.isArray(corpo.lembrete_dias) ? corpo.lembrete_dias.join(",") : corpo.lembrete_dias;
  await salvarConfiguracoes(ctx, { ...corpo, lembrete_dias: lembretes });
  return NextResponse.json(await lerConfiguracoes(ctx));
});
