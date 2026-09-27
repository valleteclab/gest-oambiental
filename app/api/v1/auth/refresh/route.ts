import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assinarToken, carregarUsuario, COOKIE_REFRESH, criarSessao, verificarToken } from "@/lib/auth";
import { naoAutenticado, rota } from "@/lib/http";

export const POST = rota(async (req: Request) => {
  const corpo = await req.json().catch(() => ({}));
  const token = corpo.refresh_token ?? (await cookies()).get(COOKIE_REFRESH)?.value;
  const sub = await verificarToken(token, "refresh");
  const u = sub ? await carregarUsuario(sub) : null;
  if (!u) throw naoAutenticado();
  await criarSessao(u.id);
  return NextResponse.json({ access_token: await assinarToken(u.id, "access"), refresh_token: await assinarToken(u.id, "refresh"), token_type: "Bearer", expires_in: 900 });
});
