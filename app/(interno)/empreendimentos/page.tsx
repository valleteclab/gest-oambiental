import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { listarEmpreendimentos } from "@/lib/cadastros/empreendimentos";
import { municipiosDoEscopo, tipologiasAtivas } from "@/lib/cadastros/opcoes";
import { ROTULO_PORTE } from "@/lib/cadastros/porte";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";

export const metadata = { title: "Empreendimentos – LicenciaGov" };

export default async function PaginaEmpreendimentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "empreendimento")) return <AcessoNegado />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 20;
  const status = sp.status === "ATIVO" || sp.status === "INATIVO" ? sp.status : null;
  const [municipios, tipologias, { total, itens }] = await Promise.all([
    municipiosDoEscopo(u, false),
    tipologiasAtivas(u),
    listarEmpreendimentos(u, { q: sp.q, municipio_id: sp.municipio || null, tipologia_id: sp.tipologia || null, status, skip: (page - 1) * size, take: size }),
  ]);
  const filtros = Object.fromEntries(Object.entries({ q: sp.q, municipio: sp.municipio, tipologia: sp.tipologia, status: sp.status }).filter(([, v]) => v)) as Record<string, string>;
  return (
    <>
      <CabecalhoPagina
        titulo="Empreendimentos"
        subtitulo={`${total} empreendimento(s) no seu escopo`}
        acoes={can(u, "criar", "empreendimento") && !isSomenteLeitura(u) ? <Link href="/empreendimentos/novo" className="btn-primario">Novo empreendimento</Link> : undefined}
      />
      <Card>
        <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_16rem_9rem_auto]" role="search">
          <div>
            <label htmlFor="q" className="label">Nome, requerente ou CAR</label>
            <input id="q" name="q" defaultValue={sp.q ?? ""} className="input" />
          </div>
          <div>
            <label htmlFor="municipio" className="label">Município</label>
            <select id="municipio" name="municipio" defaultValue={sp.municipio ?? ""} className="input">
              <option value="">Todos</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tipologia" className="label">Tipologia</label>
            <select id="tipologia" name="tipologia" defaultValue={sp.tipologia ?? ""} className="input">
              <option value="">Todas</option>
              {tipologias.map((t) => <option key={t.id} value={t.id}>{t.codigo} – {t.descricao}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="label">Situação</label>
            <select id="status" name="status" defaultValue={status ?? ""} className="input">
              <option value="">Todas</option>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </select>
          </div>
          <div className="flex items-end"><button className="btn-secundario w-full">Filtrar</button></div>
        </form>
        {itens.length === 0 ? <Vazio>Nenhum empreendimento encontrado.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Empreendimento</th><th>Município</th><th>Requerente</th><th>Tipologia</th><th>Porte</th><th className="text-right">Processos</th></tr></thead>
              <tbody>
                {itens.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/empreendimentos/${e.id}`} className="font-medium text-primaria-700 hover:underline">{e.nome}</Link>
                      {e.status === "INATIVO" && <> <Badge>Inativo</Badge></>}
                    </td>
                    <td>{e.municipio.nome}</td>
                    <td>{e.requerente.nome}</td>
                    <td><span title={e.tipologia.descricao}>{e.tipologia.codigo}</span> <span className="hidden text-xs text-slate-500 xl:inline">{e.tipologia.descricao}</span></td>
                    <td>{ROTULO_PORTE[e.porte]}</td>
                    <td className="text-right">{e._count.processos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={size} total={total} href={(p) => `/empreendimentos?${new URLSearchParams({ ...filtros, page: String(p) })}`} />
      </Card>
    </>
  );
}
