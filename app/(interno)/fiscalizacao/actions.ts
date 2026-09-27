"use server";
import { getUsuario } from "@/lib/auth";
import { isInterno } from "@/lib/rbac";
import { buscarEmpreendimentos, buscarPessoas } from "@/lib/fiscalizacao/servico";

// Buscas usadas pelos formulários de fiscalização (autocomplete). Escopo aplicado no serviço.
export async function acaoBuscarPessoas(q: string) {
  const u = await getUsuario();
  if (!u || !isInterno(u)) return [];
  return buscarPessoas(u, String(q ?? "").slice(0, 100));
}

export async function acaoBuscarEmpreendimentos(q: string, municipioId?: string | null) {
  const u = await getUsuario();
  if (!u || !isInterno(u)) return [];
  return buscarEmpreendimentos(u, String(q ?? "").slice(0, 100), municipioId || null);
}
