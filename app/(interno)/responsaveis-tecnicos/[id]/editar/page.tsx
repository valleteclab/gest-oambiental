import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { obterResponsavel } from "@/lib/cadastros/responsaveis";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormRt } from "../../_form/form-rt";
import { pessoasFisicasDisponiveis } from "../../_form/pessoas-pf";

export const metadata = { title: "Editar responsável técnico – LicenciaGov" };

export default async function EditarRt({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const rt = await obterResponsavel(u, id);
  if (rt === null) notFound();
  if (rt === "PROIBIDO" || !can(u, "editar", "pessoa") || isSomenteLeitura(u)) return <AcessoNegado />;
  const pessoas = await pessoasFisicasDisponiveis(u, rt.pessoa_id);
  if (!pessoas.some((p) => p.id === rt.pessoa_id)) pessoas.unshift({ id: rt.pessoa.id, nome: rt.pessoa.nome, cpf_cnpj_mascara: rt.pessoa.cpf_cnpj_mascara });
  return (
    <>
      <CabecalhoPagina titulo={`Editar RT: ${rt.pessoa.nome}`} />
      <Card><FormRt pessoas={pessoas} valor={rt} /></Card>
    </>
  );
}
