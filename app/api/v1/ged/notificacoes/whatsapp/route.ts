import { NextResponse } from "next/server";
import { z } from "zod";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { confirmarCodigoWhatsapp, estadoWhatsapp, revogarWhatsapp, solicitarCodigoWhatsapp } from "@/lib/ged/notificar/preferencias";

export const dynamic = "force-dynamic";

const Acao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("solicitar"), telefone: z.string().trim().min(8).max(30) }),
  z.object({ acao: z.literal("confirmar"), codigo: z.string().trim().min(6).max(10) }),
  z.object({ acao: z.literal("revogar") }),
]);

// GET → situação do WhatsApp do próprio usuário (telefone sempre mascarado)
export const GET = rota(async () => NextResponse.json(await estadoWhatsapp(await ctxGedApi()), { headers: { "Cache-Control": "private, no-store" } }));

// POST {acao: solicitar|confirmar|revogar} – opt-in por código de 6 dígitos enviado ao próprio número
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const a = Acao.parse(await req.json());
  if (a.acao === "solicitar") await solicitarCodigoWhatsapp(ctx, a.telefone);
  else if (a.acao === "confirmar") await confirmarCodigoWhatsapp(ctx, a.codigo);
  else await revogarWhatsapp(ctx);
  return NextResponse.json(await estadoWhatsapp(ctx), { headers: { "Cache-Control": "private, no-store" } });
});
