import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../../_comp/form-admin";
import { Marcador, Texto } from "../../_comp/campos";
import { salvarMunicipio } from "../actions";

export const metadata = { title: "Município – Administração" };

export default async function EditarMunicipio({ params }: { params: Promise<{ id: string }> }) {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const { id } = await params;
  const novo = id === "novo";
  const m = novo ? null : await prisma.municipio.findFirst({ where: { id, ...whereMunicipiosAdmin(admin) } }).catch(() => null);
  if (!novo && !m) notFound();
  return (
    <>
      <CabecalhoPagina titulo={m ? m.nome : "Novo município"} subtitulo={<Link href="/admin/municipios" className="underline">Municípios</Link>} />
      <Card>
        <FormAdmin action={salvarMunicipio}>
          {m && <input type="hidden" name="id" value={m.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Texto name="nome" label="Nome" required defaultValue={m?.nome} />
            {novo ? (
              <div className="grid grid-cols-2 gap-3">
                <Texto name="sigla" label="Sigla (3 letras)" required maxLength={3} />
                <Texto name="codigo_ibge" label="Código IBGE" required inputMode="numeric" maxLength={7} />
              </div>
            ) : (
              <p className="text-sm text-slate-600 sm:pt-6">Sigla <strong>{m!.sigla}</strong> · IBGE {m!.codigo_ibge} (usados na numeração – não editáveis)</p>
            )}
            <Texto className="sm:col-span-2" name="orgao_ambiental_nome" label="Órgão ambiental" required defaultValue={m?.orgao_ambiental_nome} />
            <Texto className="sm:col-span-2" name="brasao_url" label="URL do brasão" defaultValue={m?.brasao_url ?? ""} dica="URL https:// ou caminho público (ex.: /brasao-generico.svg). Usado nos PDFs." />
            <Texto className="sm:col-span-2" name="endereco" label="Endereço" defaultValue={m?.endereco ?? ""} />
            <Texto name="email" type="email" label="E-mail" defaultValue={m?.email ?? ""} />
            <Texto name="telefone" label="Telefone" defaultValue={m?.telefone ?? ""} />
            <Texto name="latitude" label="Latitude da sede" inputMode="decimal" defaultValue={m?.latitude?.toString() ?? ""} />
            <Texto name="longitude" label="Longitude da sede" inputMode="decimal" defaultValue={m?.longitude?.toString() ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Marcador name="distribuicao_auto" label="Distribuição automática de processos (rodízio entre técnicos)" defaultChecked={m?.distribuicao_auto} />
            <Marcador name="delega_decisao" label="Delega decisão ao técnico do consórcio" defaultChecked={m?.delega_decisao} />
            <Marcador name="ativo" label="Município ativo" defaultChecked={m?.ativo ?? true} />
          </div>
          {m?.brasao_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.brasao_url} alt={`Brasão de ${m.nome}`} className="h-16 w-16 object-contain" />
          )}
        </FormAdmin>
      </Card>
    </>
  );
}
