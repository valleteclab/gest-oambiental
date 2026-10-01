import { NextResponse } from "next/server";
import { naoEncontrado, proibido, rota } from "@/lib/http";
import { corpoJson, usuarioApi } from "@/lib/cadastros/api";
import { atualizarPessoa, decifrarPessoa, obterPessoa, podeVerDadosPessoais } from "@/lib/cadastros/pessoas";
import { auditar } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const u = await usuarioApi();
  const { id } = await params;
  const r = await obterPessoa(u, id);
  if (r === null) throw naoEncontrado();
  if (r === "PROIBIDO") throw proibido();
  if (r.emClaro) await auditar({ usuario_id: u.id, acao: "VISUALIZAR_DADOS_PESSOAIS", entidade: "pessoa", entidade_id: id });
  return NextResponse.json(r.dados);
});

export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const u = await usuarioApi();
  const { id } = await params;
  const p = await atualizarPessoa(u, id, await corpoJson(req));
  return NextResponse.json(podeVerDadosPessoais(u, p) ? decifrarPessoa(p) : { id: p.id });
});
