import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { fmtDataHora } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";

export const metadata = { title: "Log de auditoria – Administração" };

const dataValida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export default async function Auditoria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 50;
  const de = dataValida(sp.de);
  const ate = dataValida(sp.ate);
  const where: Prisma.LogAuditoriaWhereInput = {
    ...(sp.usuario ? { usuario_id: sp.usuario } : {}),
    ...(sp.acao ? { acao: sp.acao } : {}),
    ...(sp.entidade ? { entidade: sp.entidade } : {}),
    ...(sp.entidade_id ? { entidade_id: sp.entidade_id } : {}),
    ...(de || ate ? { created_at: { ...(de ? { gte: new Date(`${de}T00:00:00-03:00`) } : {}), ...(ate ? { lte: new Date(`${ate}T23:59:59.999-03:00`) } : {}) } } : {}),
  };
  const [total, logs, acoes, entidades, usuarios] = await Promise.all([
    prisma.logAuditoria.count({ where }),
    prisma.logAuditoria.findMany({ where, include: { usuario: { select: { nome: true, email: true } } }, orderBy: { created_at: "desc" }, skip: (page - 1) * size, take: size }),
    prisma.logAuditoria.findMany({ distinct: ["acao"], select: { acao: true }, orderBy: { acao: "asc" } }),
    prisma.logAuditoria.findMany({ distinct: ["entidade"], select: { entidade: true }, orderBy: { entidade: "asc" } }),
    prisma.usuario.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);
  const filtros = Object.fromEntries(Object.entries({ usuario: sp.usuario, acao: sp.acao, entidade: sp.entidade, entidade_id: sp.entidade_id, de, ate }).filter(([, v]) => v)) as Record<string, string>;
  return (
    <>
      <CabecalhoPagina titulo="Log de auditoria" subtitulo={<><Link href="/admin" className="underline">Administração</Link> · registros imutáveis</>} />
      <Card>
        <form className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-[1fr_12rem_12rem_10rem_10rem_auto]" role="search">
          <div>
            <label htmlFor="f-usuario" className="label">Usuário</label>
            <select id="f-usuario" name="usuario" defaultValue={sp.usuario ?? ""} className="input"><option value="">Todos</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
          </div>
          <div>
            <label htmlFor="f-acao" className="label">Ação</label>
            <select id="f-acao" name="acao" defaultValue={sp.acao ?? ""} className="input"><option value="">Todas</option>{acoes.map((a) => <option key={a.acao} value={a.acao}>{a.acao}</option>)}</select>
          </div>
          <div>
            <label htmlFor="f-entidade" className="label">Entidade</label>
            <select id="f-entidade" name="entidade" defaultValue={sp.entidade ?? ""} className="input"><option value="">Todas</option>{entidades.map((e) => <option key={e.entidade} value={e.entidade}>{e.entidade}</option>)}</select>
          </div>
          <div><label htmlFor="f-de" className="label">De</label><input id="f-de" type="date" name="de" defaultValue={de ?? ""} className="input" /></div>
          <div><label htmlFor="f-ate" className="label">Até</label><input id="f-ate" type="date" name="ate" defaultValue={ate ?? ""} className="input" /></div>
          {sp.entidade_id && <input type="hidden" name="entidade_id" value={sp.entidade_id} />}
          <div className="flex items-end gap-2"><button className="btn-secundario">Filtrar</button><Link href="/admin/auditoria" className="btn-secundario">Limpar</Link></div>
        </form>
        {sp.entidade_id && <p className="mb-2 text-sm">Filtrando registro <code>{sp.entidade_id}</code></p>}
        {logs.length === 0 ? <Vazio>Nenhum registro.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Origem</th><th>Detalhes</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{fmtDataHora(l.created_at)}</td>
                    <td>{l.usuario ? <span title={l.usuario.email}>{l.usuario.nome}</span> : <span className="text-slate-500">sistema/anônimo</span>}</td>
                    <td className="font-mono text-xs">{l.acao}</td>
                    <td className="text-xs">{l.entidade}{l.entidade_id && <div><Link className="font-mono text-slate-500 underline" href={`/admin/auditoria?entidade=${l.entidade}&entidade_id=${l.entidade_id}`}>{l.entidade_id.slice(0, 8)}…</Link></div>}</td>
                    <td className="text-xs text-slate-500">{l.ip ?? "—"}</td>
                    <td className="min-w-48">
                      {(l.antes || l.depois) ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-primaria-700">antes / depois</summary>
                          <div className="mt-2 grid gap-2 lg:grid-cols-2">
                            <div><div className="text-xs font-semibold">Antes</div><pre className="max-h-64 max-w-md overflow-auto rounded bg-slate-100 p-2 text-[11px]">{l.antes ? JSON.stringify(l.antes, null, 2) : "—"}</pre></div>
                            <div><div className="text-xs font-semibold">Depois</div><pre className="max-h-64 max-w-md overflow-auto rounded bg-slate-100 p-2 text-[11px]">{l.depois ? JSON.stringify(l.depois, null, 2) : "—"}</pre></div>
                          </div>
                        </details>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={size} total={total} href={(p) => `/admin/auditoria?${new URLSearchParams({ ...filtros, page: String(p) })}`} />
      </Card>
    </>
  );
}
