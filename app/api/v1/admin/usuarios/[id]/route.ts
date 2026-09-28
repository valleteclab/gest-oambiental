import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";
import { exigirAdmin } from "@/lib/admin/guard";
import { corpoJson } from "@/lib/cadastros/api";
import { editarUsuario, obterUsuarioAdmin } from "@/lib/admin/usuarios";

type Ctx = { params: Promise<{ id: string }> };

export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const admin = await exigirAdmin();
  const u = await obterUsuarioAdmin(admin, (await params).id);
  if (!u) throw naoEncontrado();
  return NextResponse.json(u);
});

/** PATCH {nome?, email?, cargo?, ativo?} – desativar em vez de excluir. */
export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const admin = await exigirAdmin();
  const { id } = await params;
  await editarUsuario(admin, id, await corpoJson(req));
  return NextResponse.json(await obterUsuarioAdmin(admin, id));
});
