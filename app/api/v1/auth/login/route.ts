import { NextResponse } from "next/server";
import { z } from "zod";
import { assinarToken, autenticar, criarSessao } from "@/lib/auth";
import { ErroApi, rota } from "@/lib/http";

const Corpo = z.object({ email: z.string().email(), senha: z.string().min(1) });

export const POST = rota(async (req: Request) => {
  const { email, senha } = Corpo.parse(await req.json());
  const r = await autenticar(email, senha);
  if (!r.ok) throw new ErroApi(401, "CREDENCIAIS_INVALIDAS", r.erro);
  await criarSessao(r.usuario.id);
  return NextResponse.json({
    access_token: await assinarToken(r.usuario.id, "access"),
    refresh_token: await assinarToken(r.usuario.id, "refresh"),
    token_type: "Bearer",
    expires_in: 900,
    usuario: r.usuario,
  });
});
