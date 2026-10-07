import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereOrganizacao } from "@/lib/rbac";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../../_comp/form-admin";
import { Marcador, Selecao, Texto } from "../../_comp/campos";
import { salvarTipoAto } from "../actions";

export const metadata = { title: "Tipo de ato – Administração" };

const CATEGORIAS = [{ valor: "LICENCA", rotulo: "Licença" }, { valor: "AUTORIZACAO", rotulo: "Autorização" }, { valor: "CERTIDAO", rotulo: "Certidão" }, { valor: "DECLARACAO", rotulo: "Declaração" }];
const MODELOS = [
  ...["LICENCA", "AUTORIZACAO", "CERTIDAO", "OFICIO"].map((v) => ({ valor: v, rotulo: v })),
  { valor: "AUTORIZACAO_PODA", rotulo: "AUTORIZACAO_PODA (poda/corte de árvore)" },
  { valor: "AUTORIZACAO_SOM", rotulo: "AUTORIZACAO_SOM (emissão sonora)" },
];

export default async function EditarTipoAto({ params }: { params: Promise<{ id: string }> }) {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const { id } = await params;
  const novo = id === "novo";
  const [t, checklists] = await Promise.all([novo ? null : prisma.tipoAto.findFirst({ where: { id, ...whereOrganizacao(admin) } }).catch(() => null), prisma.checklistModelo.findMany({ where: whereOrganizacao(admin), orderBy: { nome: "asc" }, select: { id: true, nome: true } })]);
  if (!novo && !t) notFound();
  return (
    <>
      <CabecalhoPagina titulo={t ? `${t.sigla} – ${t.nome}` : "Novo tipo de ato"} subtitulo={<Link href="/admin/tipos-ato" className="underline">Tipos de ato</Link>} />
      <Card>
        <FormAdmin action={salvarTipoAto}>
          {t && <input type="hidden" name="id" value={t.id} />}
          <div className="grid gap-3 sm:grid-cols-4">
            <Texto name="sigla" label="Sigla" required defaultValue={t?.sigla} maxLength={15} />
            <Texto className="sm:col-span-3" name="nome" label="Nome" required defaultValue={t?.nome} />
            <Selecao name="categoria" label="Categoria" required defaultValue={t?.categoria ?? "LICENCA"} opcoes={CATEGORIAS} />
            <Texto name="validade_meses_padrao" label="Validade (meses)" type="number" min={1} max={240} defaultValue={t?.validade_meses_padrao ?? ""} />
            <Texto name="prazo_analise_dias" label="Prazo de análise (dias)" type="number" min={1} max={720} required defaultValue={t?.prazo_analise_dias ?? 60} />
            <Selecao name="modelo_documento" label="Modelo do documento" vazio="(nenhum)" defaultValue={t?.modelo_documento ?? ""} opcoes={MODELOS} />
            <Selecao className="sm:col-span-2" name="checklist_modelo_id" label="Checklist de análise" vazio="(nenhum)" defaultValue={t?.checklist_modelo_id ?? ""} opcoes={checklists.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
          </div>
          <div className="flex flex-col gap-2">
            <Marcador name="exige_vistoria" label="Exige vistoria" defaultChecked={t?.exige_vistoria} />
            <Marcador name="exige_parecer" label="Exige parecer técnico antes da decisão" defaultChecked={t?.exige_parecer ?? true} />
            <Marcador name="ativo" label="Ativo (disponível para novos requerimentos)" defaultChecked={t?.ativo ?? true} />
          </div>
          <p className="text-xs text-slate-500">Prazo ≤ 30 dias usa a etapa “Análise curta”; acima, “Análise longa” (ver Prazos).</p>
        </FormAdmin>
      </Card>
    </>
  );
}
