import Link from "next/link";
import { exigirUsuario, getOrgaoAtivo, listarOrgaos } from "@/lib/auth";
import { isInterno, orgaosPermitidos } from "@/lib/rbac";
import { FormTrocarOrgao } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trocar órgão" };

export default async function PaginaTrocarOrgao({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const u = await exigirUsuario();
  const [todos, atual] = await Promise.all([listarOrgaos(), getOrgaoAtivo()]);
  const orgaos = orgaosPermitidos(u, todos);
  const voltar = isInterno(u) ? "/dashboard" : "/meus-processos";
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Trocar órgão</h1>
      <p className="mb-4 text-sm text-slate-600">
        {atual ? <>Órgão atual: <strong>{atual.nome}</strong>. </> : null}Escolha o órgão ambiental em que deseja atuar.
      </p>
      {orgaos.length === 0 ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Seu usuário não tem acesso a nenhum órgão ativo.</p>
      ) : (
        <FormTrocarOrgao next={next} atual={atual?.sigla} orgaos={orgaos.map((o) => ({ sigla: o.sigla, nome: o.nome, orgao: o.orgao_ambiental_nome, brasao: o.brasao_url || "/brasao-generico.svg" }))} />
      )}
      <p className="mt-4 text-center text-sm"><Link href={voltar} className="text-primaria-700 hover:underline">Voltar</Link></p>
    </>
  );
}
