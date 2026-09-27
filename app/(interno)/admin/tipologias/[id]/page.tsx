import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { faixasParaTexto } from "@/lib/cadastros/porte";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../../_comp/form-admin";
import { Marcador, Selecao, Texto } from "../../_comp/campos";
import { salvarTipologia } from "../actions";

export const metadata = { title: "Tipologia – Administração" };

export default async function EditarTipologia({ params }: { params: Promise<{ id: string }> }) {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const { id } = await params;
  const novo = id === "novo";
  const t = novo ? null : await prisma.tipologia.findUnique({ where: { id } }).catch(() => null);
  if (!novo && !t) notFound();
  return (
    <>
      <CabecalhoPagina titulo={t ? `${t.codigo} – ${t.descricao}` : "Nova tipologia"} subtitulo={<Link href="/admin/tipologias" className="underline">Tipologias</Link>} />
      <Card>
        <FormAdmin action={salvarTipologia}>
          {t && <input type="hidden" name="id" value={t.id} />}
          <div className="grid gap-3 sm:grid-cols-4">
            <Texto name="codigo" label="Código" required defaultValue={t?.codigo} />
            <Texto className="sm:col-span-3" name="divisao" label="Divisão" required defaultValue={t?.divisao} />
            <Texto className="sm:col-span-4" name="descricao" label="Descrição da atividade" required defaultValue={t?.descricao} />
            <Texto className="sm:col-span-2" name="unidade_porte" label="Unidade de porte" required defaultValue={t?.unidade_porte} dica="Ex.: área construída (m²), nº de cabeças" />
            <Selecao className="sm:col-span-2" name="potencial_poluidor" label="Potencial poluidor" required defaultValue={t?.potencial_poluidor ?? "MEDIO"} opcoes={[{ valor: "BAIXO", rotulo: "Baixo" }, { valor: "MEDIO", rotulo: "Médio" }, { valor: "ALTO", rotulo: "Alto" }]} />
            <Texto className="sm:col-span-4 font-mono" name="faixas" label="Faixas de porte" required defaultValue={t ? faixasParaTexto(t.faixas_porte) : "MICRO:|PEQUENO:|MEDIO:|GRANDE:|EXCEPCIONAL"} dica="Formato PORTE:limite_superior separados por | ; a última faixa sem limite. Ex.: MICRO:500|PEQUENO:2000|MEDIO:5000|GRANDE:10000|EXCEPCIONAL" />
          </div>
          <Marcador name="ativo" label="Ativa" defaultChecked={t?.ativo ?? true} />
        </FormAdmin>
      </Card>
    </>
  );
}
