import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { can, escopoMunicipios, isSomenteLeitura } from "@/lib/rbac";
import { obterPessoa } from "@/lib/cadastros/pessoas";
import { municipiosDoEscopo } from "@/lib/cadastros/opcoes";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormPessoa } from "../../_form/form-pessoa";

export const metadata = { title: "Editar pessoa – LicenciaGov" };

export default async function EditarPessoa({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const r = await obterPessoa(u, id);
  if (r === null) notFound();
  if (r === "PROIBIDO" || !r.emClaro || isSomenteLeitura(u) || !can(u, "editar", "pessoa", r.pessoa.municipio_id ?? undefined)) return <AcessoNegado />;
  const municipios = await municipiosDoEscopo(u);
  const d = r.dados;
  return (
    <>
      <CabecalhoPagina titulo={`Editar: ${d.nome}`} />
      <Card>
        <FormPessoa
          municipios={municipios}
          exigeMunicipio={escopoMunicipios(u) !== "TODOS"}
          valor={{ id: d.id, tipo: d.tipo, cpf_cnpj: d.cpf_cnpj_formatado, nome: d.nome, nome_fantasia: d.nome_fantasia, email: d.email, telefone: d.telefone, municipio_id: d.municipio_id, endereco: d.endereco as Record<string, string | null> | null }}
        />
      </Card>
    </>
  );
}
