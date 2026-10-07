import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { obterEmpreendimentoBasico, podeAjustarPorte } from "@/lib/cadastros/empreendimentos";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormEmpreendimento } from "../../_form/form-empreendimento";
import { opcoesEmpreendimento } from "../../_form/opcoes";

export const metadata = { title: "Editar empreendimento – LicenciaGov" };

export default async function EditarEmpreendimento({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const e = await obterEmpreendimentoBasico(u, id);
  if (e === null) notFound();
  if (e === "PROIBIDO" || !can(u, "editar", "empreendimento", e.municipio_id) || isSomenteLeitura(u)) return <AcessoNegado />;
  const [op, rtAtual] = await Promise.all([opcoesEmpreendimento(u), prisma.empreendimentoRt.findFirst({ where: { empreendimento_id: id, ate: null } })]);
  // Garante que o requerente atual apareça mesmo se fora da lista
  if (!op.requerentes.some((r) => r.id === e.requerente_id)) {
    const p = await prisma.pessoa.findUnique({ where: { id: e.requerente_id }, select: { id: true, nome: true, cpf_cnpj_mascara: true } });
    if (p) op.requerentes.unshift({ id: p.id, nome: p.nome, doc: p.cpf_cnpj_mascara });
  }
  const n = (v: { toString(): string } | null) => (v === null ? null : Number(v.toString()));
  return (
    <>
      <CabecalhoPagina titulo={`Editar: ${e.nome}`} />
      <Card>
        <FormEmpreendimento
          {...op}
          podeAjustarPorte={podeAjustarPorte(u, e.municipio_id)}
          valor={{
            id: e.id, municipio_id: e.municipio_id, requerente_id: e.requerente_id, nome: e.nome, endereco: e.endereco as Record<string, string | null> | null,
            latitude: n(e.latitude), longitude: n(e.longitude), poligono_geojson: e.poligono_geojson, tipologia_id: e.tipologia_id, grandeza_porte: n(e.grandeza_porte),
            porte: e.porte, porte_justificativa: e.porte_justificativa, area_m2: n(e.area_m2), numero_car: e.numero_car, status: e.status, rt_id: rtAtual?.rt_id ?? null,
          }}
        />
      </Card>
    </>
  );
}
