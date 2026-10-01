import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { listarResponsaveis } from "@/lib/cadastros/responsaveis";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";

export const metadata = { title: "Responsáveis técnicos – LicenciaGov" };

export default async function PaginaRts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "pessoa")) return <AcessoNegado />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 20;
  const { total, itens } = await listarResponsaveis(u, { q: sp.q, skip: (page - 1) * size, take: size });
  return (
    <>
      <CabecalhoPagina
        titulo="Responsáveis técnicos"
        subtitulo="Profissionais habilitados (conselho de classe) vinculados a empreendimentos e processos"
        acoes={can(u, "criar", "pessoa") && !isSomenteLeitura(u) ? <Link href="/responsaveis-tecnicos/novo" className="btn-primario">Novo RT</Link> : undefined}
      />
      <Card>
        <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]" role="search">
          <div>
            <label htmlFor="q" className="label">Nome, formação, registro ou CPF</label>
            <input id="q" name="q" defaultValue={sp.q ?? ""} className="input" />
          </div>
          <div className="flex items-end"><button className="btn-secundario w-full">Buscar</button></div>
        </form>
        {itens.length === 0 ? <Vazio>Nenhum responsável técnico encontrado.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Nome</th><th>Formação</th><th>Registro</th><th className="text-right">Empreend. ativos</th><th className="text-right">Processos</th></tr></thead>
              <tbody>
                {itens.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/responsaveis-tecnicos/${r.id}`} className="font-medium text-primaria-700 hover:underline">{r.pessoa.nome}</Link></td>
                    <td>{r.formacao}</td>
                    <td className="whitespace-nowrap">{r.conselho} {r.registro_conselho}/{r.uf_conselho}</td>
                    <td className="text-right">{r._count.empreendimentos}</td>
                    <td className="text-right">{r._count.processos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={size} total={total} href={(p) => `/responsaveis-tecnicos?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`} />
      </Card>
    </>
  );
}
