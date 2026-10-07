import { exigirUsuario } from "@/lib/auth";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormRt } from "../_form/form-rt";
import { pessoasFisicasDisponiveis } from "../_form/pessoas-pf";

export const metadata = { title: "Novo responsável técnico – LicenciaGov" };

export default async function NovoRt({ searchParams }: { searchParams: Promise<{ pessoa?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "criar", "pessoa") || isSomenteLeitura(u)) return <AcessoNegado mensagem="Seu perfil não permite cadastrar responsáveis técnicos." />;
  const { pessoa } = await searchParams;
  const pessoas = await pessoasFisicasDisponiveis(u);
  return (
    <>
      <CabecalhoPagina titulo="Novo responsável técnico" />
      <Card><FormRt pessoas={pessoas} valor={{ pessoa_id: pessoa }} /></Card>
    </>
  );
}
