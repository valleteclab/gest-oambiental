import "server-only";
import { exigirUsuario, getUsuario } from "@/lib/auth";
import { can, type UsuarioSessao } from "@/lib/rbac";
import { naoAutenticado, proibido } from "@/lib/http";

// Toda a área /admin (exceto exportação/backup) é exclusiva do ADMIN: can(u,'configurar','admin').

export const podeConfigurar = (u: UsuarioSessao | null) => can(u, "configurar", "admin");

/** Para páginas: retorna o usuário ou null (a página deve renderizar <AcessoNegado />). */
export async function usuarioAdminPagina(): Promise<{ u: UsuarioSessao; ok: boolean }> {
  const u = await exigirUsuario({ interno: true });
  return { u, ok: podeConfigurar(u) };
}

/** Para Server Actions/rotas: lança 401/403. */
export async function exigirAdmin(): Promise<UsuarioSessao> {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!podeConfigurar(u)) throw proibido("Apenas o administrador do consórcio pode alterar configurações.");
  return u;
}

/** Resultado padrão das Server Actions do admin. */
export type EstadoAcao = { ok?: boolean; erro?: string; mensagem?: string; campos?: Record<string, string>; extra?: Record<string, string> } | undefined;

export function erroParaEstado(e: unknown): EstadoAcao {
  const err = e as { message?: string; issues?: { path: PropertyKey[]; message: string }[]; details?: { campo?: string } };
  if (err?.issues) {
    const campos: Record<string, string> = {};
    for (const i of err.issues) campos[i.path.map(String).join(".") || "_"] ??= i.message;
    return { erro: "Verifique os campos destacados.", campos };
  }
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string" && "status" in err) {
    const campo = err.details?.campo;
    return { erro: err.message ?? "Erro.", campos: campo ? { [campo]: err.message ?? "" } : undefined };
  }
  if ((err as { code?: string })?.code === "P2002") return { erro: "Registro duplicado (já existe um cadastro com esses dados)." };
  console.error(e);
  return { erro: "Não foi possível concluir a operação." };
}
