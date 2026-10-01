import "server-only";
import { notFound } from "next/navigation";
import { ErroApi } from "@/lib/http";
import type { UsuarioSessao } from "@/lib/rbac";
import { obterProcessoAutorizado, type ProcessoCompleto } from "@/lib/processo/consultas";

/** Carrega processo para páginas: 404 → notFound(); 403 → { proibido: true } (a página renderiza <Proibido/>). */
export async function carregarProcessoPagina(id: string, u: UsuarioSessao): Promise<{ p: ProcessoCompleto; proibido?: false } | { p?: undefined; proibido: true }> {
  try {
    return { p: await obterProcessoAutorizado(id, u) };
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    if (e instanceof ErroApi && e.status === 403) return { proibido: true };
    throw e;
  }
}
