import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assinarToken, carregarUsuario, COOKIE_REFRESH, criarSessao, falhaRefreshIp, refreshBloqueadoPorIp, verificarToken } from "@/lib/auth";
import { ErroApi, naoAutenticado, rota } from "@/lib/http";
import { MENSAGEM_MUITAS_TENTATIVAS } from "@/lib/limite-login";

export const POST = rota(async (req: Request) => {
  // Limite por IP: só tokens inválidos contam (renovações legítimas não consomem a cota).
  if (await refreshBloqueadoPorIp()) throw new ErroApi(429, "MUITAS_TENTATIVAS", MENSAGEM_MUITAS_TENTATIVAS);
  const corpo = await req.json().catch(() => ({}));
  const token = corpo.refresh_token ?? (await cookies()).get(COOKIE_REFRESH)?.value;
  const sub = await verificarToken(token, "refresh");
  const u = sub ? await carregarUsuario(sub) : null;
  if (!u) {
    await falhaRefreshIp();
    throw naoAutenticado();
  }
  await criarSessao(u.id);
  return NextResponse.json({ access_token: await assinarToken(u.id, "access"), refresh_token: await assinarToken(u.id, "refresh"), token_type: "Bearer", expires_in: 900 });
});
