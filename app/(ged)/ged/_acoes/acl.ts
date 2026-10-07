"use server";
// Server Actions do painel de ACL (components/ged/acl-painel.tsx). Cada ação refaz a checagem de sessão/permissão.
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { concederAcl, definirAclPropriaDocumento, definirHerancaPasta, revogarAcl } from "@/lib/ged/acl";
import { ctxGedApi } from "@/lib/ged/escopo";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
/** Só revalida caminhos internos do GED. */
const revalidar = (f: FormData) => {
  const c = txt(f, "caminho");
  if (/^\/ged(\/[A-Za-z0-9._~-]+)*$/.test(c)) revalidatePath(c);
};

export async function concederAclAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const [tipo, id] = txt(f, "principal").split(":");
    const alvoTipo = txt(f, "alvo_tipo");
    const r = await concederAcl(ctx, {
      alvo: { tipo: alvoTipo, id: txt(f, "alvo_id") },
      principal: { tipo, id },
      acoes: f.getAll("acoes").map(String),
      expira_em: txt(f, "expira_em") || null,
    });
    revalidar(f);
    return r.criada ? "Permissão concedida." : "Permissão atualizada.";
  });
}

export async function revogarAclAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await revogarAcl(ctx, txt(f, "acl_id"));
    revalidar(f);
    return "Permissão removida.";
  });
}

export async function alternarHerancaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const herda = txt(f, "herda") === "true";
    if (txt(f, "alvo_tipo") === "pasta") await definirHerancaPasta(ctx, txt(f, "alvo_id"), herda);
    else await definirAclPropriaDocumento(ctx, txt(f, "alvo_id"), !herda);
    revalidar(f);
    return herda ? "Herança de permissões ativada." : "Herança de permissões desativada.";
  });
}
