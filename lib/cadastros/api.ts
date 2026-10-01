import "server-only";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado } from "@/lib/http";
import type { UsuarioSessao } from "@/lib/rbac";

/** Usuário autenticado da requisição de API (cookie ou Bearer) ou 401. */
export async function usuarioApi(): Promise<UsuarioSessao> {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  return u;
}

export async function corpoJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
