import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { candidatosSignatarios } from "@/lib/ged/assinaturas/servico";
import { ctxGedApi } from "@/lib/ged/escopo";
import { podeSolicitarAssinatura } from "@/lib/ged/papeis";
import { proibido } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/assinaturas/candidatos?q=nome  → { itens: [{ id, nome, cargo, papel }] } (membros ativos do próprio cliente)
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  if (!podeSolicitarAssinatura(ctx)) throw proibido("Seu papel não permite solicitar assinaturas.");
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return NextResponse.json({ itens: await candidatosSignatarios(ctx, q?.slice(0, 100)) });
});
