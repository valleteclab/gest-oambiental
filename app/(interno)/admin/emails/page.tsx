import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { fmtDataHora } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";

export const metadata = { title: "Caixa de e-mails – Administração" };

export default async function Emails({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 30;
  const where = sp.q ? { OR: [{ para: { contains: sp.q, mode: "insensitive" as const } }, { assunto: { contains: sp.q, mode: "insensitive" as const } }] } : {};
  const [total, emails] = await Promise.all([prisma.emailEnviado.count({ where }), prisma.emailEnviado.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * size, take: size })]);
  return (
    <>
      <CabecalhoPagina titulo="Caixa de e-mails" subtitulo={<><Link href="/admin" className="underline">Administração</Link> · todos os e-mails gerados pelo sistema (caixa de teste quando não há SMTP configurado)</>} />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          <div className="min-w-64 flex-1"><label htmlFor="q" className="label">Destinatário ou assunto</label><input id="q" name="q" defaultValue={sp.q ?? ""} className="input" /></div>
          <button className="btn-secundario">Buscar</button>
        </form>
        {emails.length === 0 ? <Vazio>Nenhum e-mail.</Vazio> : (
          <ul className="divide-y divide-slate-100" data-testid="caixa-emails">
            {emails.map((e) => (
              <li key={e.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">{e.assunto}</span>
                    <span className="text-slate-600">para {e.para}</span>
                    <span className="text-xs text-slate-500">{fmtDataHora(e.created_at)}</span>
                    {e.enviado ? <Badge cor="verde">Enviado</Badge> : e.erro ? <Badge cor="vermelho">Erro</Badge> : <Badge cor="azul">Caixa de teste</Badge>}
                  </summary>
                  {e.erro && <p className="mt-2 text-xs text-red-700">{e.erro}</p>}
                  <iframe title={`Conteúdo do e-mail: ${e.assunto}`} sandbox="" srcDoc={e.corpo} className="mt-2 h-72 w-full rounded border border-slate-200 bg-white" />
                </details>
              </li>
            ))}
          </ul>
        )}
        <Paginacao page={page} size={size} total={total} href={(p) => `/admin/emails?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`} />
      </Card>
    </>
  );
}
