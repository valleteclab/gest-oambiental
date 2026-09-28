import { NextResponse } from "next/server";
import { encerrarSessao, getUsuario } from "@/lib/auth";
import { auditar } from "@/lib/audit";

export async function GET() {
  const u = await getUsuario();
  if (u) await auditar({ usuario_id: u.id, acao: "LOGOUT", entidade: "usuario", entidade_id: u.id });
  await encerrarSessao();
  // Location relativo: atrás de proxy (Railway) req.url traz o host interno (0.0.0.0:3000)
  return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
}
