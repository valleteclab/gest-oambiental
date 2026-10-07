import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, naoEncontrado, rota } from "@/lib/http";
import { marcarAlertaLido } from "@/lib/alertas/consultas";

// POST /api/v1/alertas/{id}/lido – marca um alerta do próprio usuário como lido
export const POST = rota(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const id = z.string().uuid().parse((await ctx.params).id);
  if (!(await marcarAlertaLido(id, u.id))) throw naoEncontrado("Alerta não encontrado.");
  return NextResponse.json({ ok: true });
});
