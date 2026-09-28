import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { listarUsuarios, PAPEIS } from "@/lib/admin/usuarios";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { ROTULO_PAPEL } from "@/lib/rbac";
import { fmtDataHora } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";

export const metadata = { title: "Usuários – Administração" };

export default async function Usuarios({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 30;
  const ativo = sp.ativo === "1" ? true : sp.ativo === "0" ? false : null;
  const [municipios, { total, itens }] = await Promise.all([
    prisma.municipio.findMany({ where: whereMunicipiosAdmin(admin), orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    listarUsuarios(admin, { q: sp.q, papel: sp.papel, municipio_id: sp.municipio, ativo, skip: (page - 1) * size, take: size }),
  ]);
  const filtros = Object.fromEntries(Object.entries({ q: sp.q, papel: sp.papel, municipio: sp.municipio, ativo: sp.ativo }).filter(([, v]) => v)) as Record<string, string>;
  return (
    <>
      <CabecalhoPagina titulo="Usuários e papéis" subtitulo={<Link href="/admin" className="underline">Administração</Link>} acoes={<Link href="/admin/usuarios/novo" className="btn-primario">Novo usuário</Link>} />
      <Card>
        <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_12rem_9rem_auto]" role="search">
          <div><label htmlFor="q" className="label">Nome ou e-mail</label><input id="q" name="q" defaultValue={sp.q ?? ""} className="input" /></div>
          <div>
            <label htmlFor="papel" className="label">Papel</label>
            <select id="papel" name="papel" defaultValue={sp.papel ?? ""} className="input"><option value="">Todos</option>{PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}</select>
          </div>
          <div>
            <label htmlFor="municipio" className="label">Município</label>
            <select id="municipio" name="municipio" defaultValue={sp.municipio ?? ""} className="input"><option value="">Todos</option>{municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
          </div>
          <div>
            <label htmlFor="ativo" className="label">Situação</label>
            <select id="ativo" name="ativo" defaultValue={sp.ativo ?? ""} className="input"><option value="">Todos</option><option value="1">Ativos</option><option value="0">Inativos</option></select>
          </div>
          <div className="flex items-end"><button className="btn-secundario w-full">Filtrar</button></div>
        </form>
        {itens.length === 0 ? <Vazio>Nenhum usuário encontrado.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Usuário</th><th>Papéis</th><th>Último acesso</th><th>Situação</th></tr></thead>
              <tbody>
                {itens.map((u) => (
                  <tr key={u.id}>
                    <td><Link href={`/admin/usuarios/${u.id}`} className="font-medium text-primaria-700 hover:underline">{u.nome}</Link><div className="text-xs text-slate-500">{u.email}{u.cargo ? ` · ${u.cargo}` : ""}</div></td>
                    <td className="space-x-1 space-y-1">{u.papeis.map((p) => <Badge key={p.id} cor="azul">{ROTULO_PAPEL[p.papel]}{p.municipio ? ` – ${p.municipio.sigla}` : ""}</Badge>)}</td>
                    <td className="whitespace-nowrap">{fmtDataHora(u.ultimo_login)}</td>
                    <td>{u.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge cor="vermelho">Inativo</Badge>}{u.trocar_senha && <> <Badge cor="amarelo">Troca de senha</Badge></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={size} total={total} href={(p) => `/admin/usuarios?${new URLSearchParams({ ...filtros, page: String(p) })}`} />
      </Card>
    </>
  );
}
