import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card } from "@/components/ui";

export const metadata = { title: "Municípios – Administração" };

export default async function Municipios() {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const lista = await prisma.municipio.findMany({ where: whereMunicipiosAdmin(admin), orderBy: { nome: "asc" }, include: { _count: { select: { papeis: true, processos: true } } } });
  return (
    <>
      <CabecalhoPagina titulo="Municípios" subtitulo={<Link href="/admin" className="underline">Administração</Link>} acoes={<Link href="/admin/municipios/novo" className="btn-primario">Novo município</Link>} />
      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Município</th><th>Sigla</th><th>IBGE</th><th>Distribuição</th><th>Decisão delegada</th><th className="text-right">Usuários</th><th className="text-right">Processos</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id}>
                  <td><Link href={`/admin/municipios/${m.id}`} className="font-medium text-primaria-700 hover:underline">{m.nome}</Link><div className="text-xs text-slate-500">{m.orgao_ambiental_nome}</div></td>
                  <td>{m.sigla}</td>
                  <td>{m.codigo_ibge}</td>
                  <td>{m.distribuicao_auto ? "Automática" : "Manual"}</td>
                  <td>{m.delega_decisao ? "Sim" : "Não"}</td>
                  <td className="text-right">{m._count.papeis}</td>
                  <td className="text-right">{m._count.processos}</td>
                  <td>{m.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
