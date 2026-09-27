import { exigirUsuario } from "@/lib/auth";
import { can, escopoMunicipios, isSomenteLeitura } from "@/lib/rbac";
import { municipiosDoEscopo } from "@/lib/cadastros/opcoes";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormPessoa } from "../_form/form-pessoa";

export const metadata = { title: "Nova pessoa – LicenciaGov" };

export default async function NovaPessoa({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "criar", "pessoa") || isSomenteLeitura(u)) return <AcessoNegado mensagem="Seu perfil não permite cadastrar pessoas." />;
  const municipios = await municipiosDoEscopo(u);
  const { tipo } = await searchParams;
  const exige = escopoMunicipios(u) !== "TODOS";
  return (
    <>
      <CabecalhoPagina titulo="Nova pessoa" />
      <Card><FormPessoa municipios={municipios} exigeMunicipio={exige} valor={{ tipo: tipo === "PF" ? "PF" : "PJ", municipio_id: municipios.length === 1 ? municipios[0].id : null }} /></Card>
    </>
  );
}
