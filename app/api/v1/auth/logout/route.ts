import { NextResponse } from "next/server";
import { encerrarSessao, getUsuario } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { rota } from "@/lib/http";

export const POST = rota(async () => {
  const u = await getUsuario();
  if (u) await auditar({ usuario_id: u.id, acao: "LOGOUT", entidade: "usuario", entidade_id: u.id });
  await encerrarSessao();
  return NextResponse.json({ ok: true });
});
