import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormAdmin } from "../_comp/form-admin";
import { Selecao, Texto } from "../_comp/campos";
import { adicionarFeriado, removerFeriado } from "./actions";

export const metadata = { title: "Feriados – Administração" };

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default async function Feriados({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const anoAtual = new Date().getFullYear();
  const ano = Number((await searchParams).ano) || anoAtual;
  const [feriados, municipios] = await Promise.all([
    prisma.feriado.findMany({ where: { OR: [{ municipio_id: null }, { municipio: whereMunicipiosAdmin(admin) }], data: { gte: new Date(`${ano}-01-01T00:00:00Z`), lt: new Date(`${ano + 1}-01-01T00:00:00Z`) } }, include: { municipio: { select: { nome: true } } }, orderBy: { data: "asc" } }),
    prisma.municipio.findMany({ where: whereMunicipiosAdmin(admin), orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  return (
    <>
      <CabecalhoPagina
        titulo={`Feriados de ${ano}`}
        subtitulo={<Link href="/admin" className="underline">Administração</Link>}
        acoes={<><Link className="btn-secundario" href={`/admin/feriados?ano=${ano - 1}`}>← {ano - 1}</Link><Link className="btn-secundario" href={`/admin/feriados?ano=${ano + 1}`}>{ano + 1} →</Link></>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          {feriados.length === 0 ? <Vazio>Nenhum feriado cadastrado para {ano}.</Vazio> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {feriados.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-mono">{f.data.toISOString().slice(0, 10).split("-").reverse().join("/")}</span> <span className="text-slate-500">({DIAS[f.data.getUTCDay()]})</span> – {f.descricao}
                    <span className="ml-2 text-xs text-slate-500">{f.municipio ? f.municipio.nome : "nacional (todos os municípios)"}</span>
                  </span>
                  {f.municipio_id && <FormAdmin action={removerFeriado} inline botao="Remover" classeBotao="btn-secundario" confirmar={`Remover o feriado "${f.descricao}"?`} rotuloAcessivel={`Remover ${f.descricao}`}>
                    <input type="hidden" name="id" value={f.id} />
                  </FormAdmin>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo="Novo feriado">
          <FormAdmin action={adicionarFeriado} botao="Adicionar" limparAoSalvar>
            <Texto name="data" label="Data" type="date" required />
            <Texto name="descricao" label="Descrição" required />
            <Selecao name="municipio_id" label="Município" required vazio="Selecione…" opcoes={municipios.map((m) => ({ valor: m.id, rotulo: m.nome }))} />
            <p className="text-xs text-slate-500">Feriados nacionais são mantidos pela plataforma e valem para todos os órgãos.</p>
          </FormAdmin>
        </Card>
      </div>
    </>
  );
}
