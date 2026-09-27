import { NextResponse } from "next/server";
import { z } from "zod";
import { assinarToken, autenticar, criarSessao, resolverOrgao } from "@/lib/auth";
import { ErroApi, rota } from "@/lib/http";

// `orgao` (opcional): sigla (ex.: "LOR") ou id do município em que o usuário vai atuar – mesma regra do /login.
const Corpo = z.object({ email: z.string().email(), senha: z.string().min(1), orgao: z.string().trim().min(1).max(64).optional() });

export const POST = rota(async (req: Request) => {
  const { email, senha, orgao: orgaoPedido } = Corpo.parse(await req.json());
  const orgao = orgaoPedido ? await resolverOrgao(orgaoPedido) : null;
  if (orgaoPedido && !orgao) throw new ErroApi(422, "ORGAO_INVALIDO", "Órgão não encontrado ou inativo.", { campo: "orgao" });
  const r = await autenticar(email, senha, orgao);
  if (!r.ok) {
    if (r.motivo === "orgao_sem_acesso") throw new ErroApi(403, "ORGAO_SEM_ACESSO", r.erro);
    throw new ErroApi(401, "CREDENCIAIS_INVALIDAS", r.erro);
  }
  await criarSessao(r.usuario.id, orgao);
  return NextResponse.json({
    access_token: await assinarToken(r.usuario.id, "access"),
    refresh_token: await assinarToken(r.usuario.id, "refresh"),
    token_type: "Bearer",
    expires_in: 900,
    usuario: r.usuario,
    orgao,
  });
});
