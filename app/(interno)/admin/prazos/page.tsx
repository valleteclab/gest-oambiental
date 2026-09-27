import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../_comp/form-admin";
import { Marcador, Selecao, Texto } from "../_comp/campos";
import { removerPrazo, salvarPrazo } from "./actions";

export const metadata = { title: "Prazos – Administração" };

const ETAPAS: Record<string, string> = { TRIAGEM: "Triagem", ANALISE_CURTA: "Análise curta (LS/AA/CERT…)", ANALISE_LONGA: "Análise longa (LP/LI/LO/LU…)", PENDENCIA: "Resposta a pendência", VISTORIA: "Vistoria", DECISAO: "Decisão" };

export default async function Prazos() {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const [prazos, municipios] = await Promise.all([
    prisma.prazoConfig.findMany({ include: { municipio: { select: { nome: true } } }, orderBy: [{ etapa: "asc" }, { municipio_id: { sort: "asc", nulls: "first" } }] }),
    prisma.municipio.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const ordem = Object.keys(ETAPAS);
  prazos.sort((a, b) => ordem.indexOf(a.etapa) - ordem.indexOf(b.etapa) || (a.municipio_id ? 1 : 0) - (b.municipio_id ? 1 : 0));
  return (
    <>
      <CabecalhoPagina titulo="Prazos" subtitulo={<><Link href="/admin" className="underline">Administração</Link> · a configuração do município prevalece sobre a da organização</>} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {prazos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-end gap-3 py-3">
              <div className="w-64">
                <div className="font-medium">{ETAPAS[p.etapa] ?? p.etapa}</div>
                <div className="text-xs text-slate-500">{p.municipio ? `Exceção: ${p.municipio.nome}` : "Padrão da organização"}</div>
              </div>
              <FormAdmin action={salvarPrazo} inline rotuloAcessivel={`Prazo ${p.etapa}`}>
                <input type="hidden" name="id" value={p.id} />
                <Texto name="dias" label="Dias" type="number" min={1} defaultValue={p.dias} className="w-24" />
                <Texto name="dias_alerta" label="Alerta (dias antes)" type="number" min={0} defaultValue={p.dias_alerta} className="w-36" />
                <Marcador name="conta_dias_uteis" label="Dias úteis" defaultChecked={p.conta_dias_uteis} className="pb-2" />
              </FormAdmin>
              {p.municipio_id && (
                <FormAdmin action={removerPrazo} inline botao="Remover" classeBotao="btn-secundario" confirmar="Remover esta exceção municipal?" rotuloAcessivel="Remover exceção">
                  <input type="hidden" name="id" value={p.id} />
                </FormAdmin>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card titulo="Nova configuração (padrão ou exceção por município)" className="mt-6">
        <FormAdmin action={salvarPrazo} botao="Adicionar" limparAoSalvar>
          <div className="grid gap-3 sm:grid-cols-4">
            <Selecao name="etapa" label="Etapa" required opcoes={Object.entries(ETAPAS).map(([v, r]) => ({ valor: v, rotulo: r }))} />
            <Selecao name="municipio_id" label="Município" vazio="(organização)" opcoes={municipios.map((m) => ({ valor: m.id, rotulo: m.nome }))} />
            <Texto name="dias" label="Dias" type="number" min={1} required />
            <Texto name="dias_alerta" label="Alerta (dias antes)" type="number" min={0} defaultValue={5} required />
          </div>
          <Marcador name="conta_dias_uteis" label="Contar apenas dias úteis (fins de semana e feriados excluídos)" />
        </FormAdmin>
      </Card>
    </>
  );
}
