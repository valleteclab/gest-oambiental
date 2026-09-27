import type { Metadata } from "next";
import Link from "next/link";
import { listarLicencasPublicas, opcoesFiltroPublico } from "@/lib/documentos/publico";
import { ROTULO_STATUS_PUBLICO } from "@/lib/documentos/render";
import { fmtData } from "@/lib/format";
import { Badge, Paginacao, Vazio } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Licenças emitidas" };

const COR = { VALIDO: "verde", VENCIDO: "amarelo", CANCELADO: "vermelho", SUBSTITUIDO: "amarelo" } as const;
const TAMANHO = 20;

type SP = { municipio?: string; tipo?: string; sigla?: string; de?: string; ate?: string; page?: string };

export default async function LicencasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [{ municipios, siglas }, r] = await Promise.all([
    opcoesFiltroPublico(),
    listarLicencasPublicas({ municipio: sp.municipio, tipo: sp.tipo, sigla: sp.sigla, de: sp.de, ate: sp.ate, skip: (page - 1) * TAMANHO, take: TAMANHO }),
  ]);
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/licencas?${q}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Licenças emitidas</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">Transparência ativa: licenças, autorizações e certidões ambientais emitidas pelos municípios. Clique em “Validar” para conferir a autenticidade de cada documento.</p>
      </div>

      <form method="get" action="/licencas" className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <label className="block"><span className="label">Município</span>
          <select name="municipio" defaultValue={sp.municipio ?? ""} className="input">
            <option value="">Todos</option>
            {municipios.map((m) => <option key={m.sigla} value={m.sigla}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Tipo</span>
          <select name="tipo" defaultValue={sp.tipo ?? ""} className="input">
            <option value="">Todos</option>
            <option value="LICENCA">Licenças</option>
            <option value="AUTORIZACAO">Autorizações</option>
            <option value="CERTIDAO">Certidões</option>
          </select>
        </label>
        <label className="block"><span className="label">Modalidade</span>
          <select name="sigla" defaultValue={sp.sigla ?? ""} className="input">
            <option value="">Todas</option>
            {siglas.map((s) => <option key={s.sigla} value={s.sigla}>{s.sigla} – {s.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Emitidas de</span><input type="date" name="de" defaultValue={sp.de ?? ""} className="input" /></label>
        <label className="block"><span className="label">até</span><input type="date" name="ate" defaultValue={sp.ate ?? ""} className="input" /></label>
        <div className="flex gap-2">
          <button className="btn-primario flex-1" type="submit">Filtrar</button>
          <Link className="btn-secundario" href="/licencas">Limpar</Link>
        </div>
      </form>

      <section className="card">
        {r.itens.length === 0 ? (
          <Vazio>Nenhum documento encontrado com os filtros informados.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-licencas">
              <caption className="sr-only">Licenças, autorizações e certidões emitidas</caption>
              <thead>
                <tr><th scope="col">Número</th><th scope="col">Documento</th><th scope="col">Titular</th><th scope="col">Empreendimento</th><th scope="col">Município</th><th scope="col">Emissão</th><th scope="col">Validade</th><th scope="col">Situação</th><th scope="col"><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {r.itens.map((d) => (
                  <tr key={d.codigo_verificador}>
                    <td className="whitespace-nowrap font-mono">{d.numero}</td>
                    <td>{d.titulo}</td>
                    <td>{d.titular ? <>{d.titular.nome}<span className="block text-xs text-slate-500">{d.titular.documento}</span></> : "—"}</td>
                    <td>{d.empreendimento ?? "—"}</td>
                    <td>{d.municipio}</td>
                    <td className="whitespace-nowrap">{fmtData(d.emitido_em)}</td>
                    <td className="whitespace-nowrap">{fmtData(d.validade_ate)}</td>
                    <td><Badge cor={COR[d.status]}>{ROTULO_STATUS_PUBLICO[d.status]}</Badge></td>
                    <td><Link className="text-primaria-700 underline" href={`/validar/${d.codigo_verificador}`}>Validar</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-4"><Paginacao page={page} size={TAMANHO} total={r.total} href={href} /></div>
      </section>
      <p className="text-xs text-slate-500">Dados abertos: <a className="underline" href="/api/v1/public/licencas">/api/v1/public/licencas</a> (JSON, mesmos filtros).</p>
    </div>
  );
}
