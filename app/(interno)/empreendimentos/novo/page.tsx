import { exigirUsuario } from "@/lib/auth";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { podeAjustarPorte } from "@/lib/cadastros/empreendimentos";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormEmpreendimento } from "../_form/form-empreendimento";
import { opcoesEmpreendimento } from "../_form/opcoes";

export const metadata = { title: "Novo empreendimento – LicenciaGov" };

export default async function NovoEmpreendimento({ searchParams }: { searchParams: Promise<{ requerente?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "criar", "empreendimento") || isSomenteLeitura(u)) return <AcessoNegado mensagem="Seu perfil não permite cadastrar empreendimentos." />;
  const { requerente } = await searchParams;
  const op = await opcoesEmpreendimento(u);
  return (
    <>
      <CabecalhoPagina titulo="Novo empreendimento" />
      <Card><FormEmpreendimento {...op} podeAjustarPorte={podeAjustarPorte(u)} valor={{ requerente_id: requerente }} /></Card>
    </>
  );
}
