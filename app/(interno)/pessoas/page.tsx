import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { listarPessoas } from "@/lib/cadastros/pessoas";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";

export const metadata = { title: "Pessoas – LicenciaGov" };

export default async function PaginaPessoas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "pessoa")) return <AcessoNegado />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 20;
  const tipo = sp.tipo === "PF" || sp.tipo === "PJ" ? sp.tipo : null;
  const { total, itens } = await listarPessoas(u, { q: sp.q, tipo, skip: (page - 1) * size, take: size });
  const href = (p: number) => `/pessoas?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(tipo ? { tipo } : {}), page: String(p) })}`;
  return (
    <>
      <CabecalhoPagina
        titulo="Pessoas"
        subtitulo="Requerentes, autuados e responsáveis técnicos (PF/PJ)"
        acoes={can(u, "criar", "pessoa") && !isSomenteLeitura(u) ? <Link href="/pessoas/nova" className="btn-primario">Nova pessoa</Link> : undefined}
      />
      <Card>
        <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto]" role="search">
          <div>
            <label htmlFor="q" className="label">Nome ou CPF/CNPJ</label>
            <input id="q" name="q" defaultValue={sp.q ?? ""} className="input" placeholder="Ex.: Laticínio ou 11.222.333/0001-81" />
          </div>
          <div>
            <label htmlFor="tipo" className="label">Tipo</label>
            <select id="tipo" name="tipo" defaultValue={tipo ?? ""} className="input">
              <option value="">Todos</option>
              <option value="PF">Pessoa física</option>
              <option value="PJ">Pessoa jurídica</option>
            </select>
          </div>
          <div className="flex items-end"><button className="btn-secundario w-full">Filtrar</button></div>
        </form>
        {itens.length === 0 ? (
          <Vazio>Nenhuma pessoa encontrada.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr><th>Nome</th><th>Tipo</th><th>CPF/CNPJ</th><th>Município</th></tr>
              </thead>
              <tbody>
                {itens.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/pessoas/${p.id}`} className="font-medium text-primaria-700 hover:underline">{p.nome}</Link>
                      {p.nome_fantasia && <div className="text-xs text-slate-500">{p.nome_fantasia}</div>}
                      {p.responsavel_tecnico && <Badge cor="roxo">RT</Badge>}
                    </td>
                    <td>{p.tipo}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{p.cpf_cnpj_mascara}</td>
                    <td>{p.municipio?.nome ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={size} total={total} href={href} />
      </Card>
    </>
  );
}
