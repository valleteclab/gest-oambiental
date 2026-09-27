import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card, Vazio } from "@/components/ui";

export const metadata = { title: "Checklists – Administração" };

export default async function Checklists() {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const lista = await prisma.checklistModelo.findMany({ orderBy: { nome: "asc" }, include: { tipos_ato: { select: { sigla: true } }, _count: { select: { preenchidos: true } } } });
  return (
    <>
      <CabecalhoPagina titulo="Checklists" subtitulo={<Link href="/admin" className="underline">Administração</Link>} acoes={<Link href="/admin/checklists/novo" className="btn-primario">Novo checklist</Link>} />
      <Card>
        {lista.length === 0 ? <Vazio>Nenhum checklist.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Nome</th><th className="text-right">Itens</th><th>Tipos de ato</th><th className="text-right">Preenchidos</th></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/admin/checklists/${c.id}`} className="font-medium text-primaria-700 hover:underline">{c.nome}</Link></td>
                  <td className="text-right">{Array.isArray(c.itens) ? c.itens.length : 0}</td>
                  <td>{c.tipos_ato.map((t) => t.sigla).join(", ") || "—"}</td>
                  <td className="text-right">{c._count.preenchidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
