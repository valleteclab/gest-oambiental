"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { autenticar, criarSessao, listarOrgaos, resolverOrgao } from "@/lib/auth";
import { isInterno, orgaosPermitidos } from "@/lib/rbac";

export type EstadoLogin = { erro?: string; email?: string; orgao?: string } | undefined;

const destinoSeguro = (d: string) => (d.startsWith("/") && !d.startsWith("//") ? d : "");

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "");
  const senha = String(form.get("senha") ?? "");
  const siglaOrgao = String(form.get("orgao") ?? "").trim();
  const destino = destinoSeguro(String(form.get("next") ?? ""));
  // Órgão escolhido na tela: valida o acesso já na autenticação (mesma regra do "Trocar órgão").
  const orgao = siglaOrgao ? await resolverOrgao(siglaOrgao) : null;
  if (siglaOrgao && !orgao) return { erro: "Órgão não encontrado ou inativo.", email, orgao: siglaOrgao };
  const r = await autenticar(email, senha, orgao);
  if (!r.ok) return { erro: r.erro, email, orgao: orgao?.sigla ?? "" };

  // Sem órgão escolhido: usa o único órgão permitido ao usuário ou pede a escolha entre os PERMITIDOS
  // (/trocar-orgao lista somente os órgãos da organização do usuário – nunca os de outro cliente).
  let ativo = orgao;
  let escolherDepois = false;
  if (!ativo) {
    const permitidos = orgaosPermitidos(r.usuario, await listarOrgaos());
    if (permitidos.length === 1) ativo = permitidos[0];
    else escolherDepois = permitidos.length > 1;
  }
  await criarSessao(r.usuario.id, ativo);
  if (r.usuario.trocar_senha) redirect("/trocar-senha");
  // GED (docs/ged-design.md §1.1): quem não é interno do licenciamento mas é membro ativo de um cliente com o módulo GED vai para /ged.
  const temGed = !isInterno(r.usuario) && (await prisma.gedMembro.count({ where: { usuario_id: r.usuario.id, ativo: true, organizacao: { modulos: { has: "GED" } } } })) > 0;
  const final = destino || (isInterno(r.usuario) ? "/dashboard" : temGed ? "/ged" : "/meus-processos");
  if (escolherDepois) redirect(`/trocar-orgao?next=${encodeURIComponent(final)}`);
  redirect(final);
}
