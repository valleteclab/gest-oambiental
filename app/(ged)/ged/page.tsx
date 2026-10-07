import Link from "next/link";
import { Badge, Card, CabecalhoPagina } from "@/components/ui";
import { exigirGed } from "@/lib/ged/escopo";
import { whereGedVisivel } from "@/lib/ged/permissoes";
import { podeCriarDocumento, podeGerirEstruturaGed, podeVerLogs } from "@/lib/ged/papeis";
import { COR_STATUS_DOCUMENTO_GED, NOME_MODULO_GED, ROTULO_STATUS_DOCUMENTO_GED } from "@/lib/ged/tipos";
import { fmtDataHora } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: NOME_MODULO_GED };

export default async function InicioGed() {
  const ctx = await exigirGed();
  const visiveis = { AND: [await whereGedVisivel(ctx, "VER"), { excluido_em: null }] };
  const [total, aAssinar, noMeuTramite, recentes] = await Promise.all([
    ctx.db.gedDocumento.count({ where: visiveis }),
    ctx.db.gedAssinante.count({ where: { usuario_id: ctx.usuario.id, status: "PENDENTE", solicitacao: { status: "ABERTA" } } }),
    ctx.db.gedDocumento.count({ where: { responsavel_id: ctx.usuario.id, excluido_em: null } }),
    ctx.db.gedDocumento.findMany({ where: visiveis, orderBy: { updated_at: "desc" }, take: 6, select: { id: true, numero: true, titulo: true, status: true, updated_at: true } }),
  ]);

  const atalhos = [
    { href: "/ged/documentos", rotulo: "Documentos", texto: "Buscar e consultar documentos por título, data, remetente ou conteúdo.", mostrar: true },
    { href: "/ged/documentos/novo", rotulo: "Novo documento", texto: "Enviar um PDF ou criar um documento no editor.", mostrar: podeCriarDocumento(ctx) },
    { href: "/ged/assinaturas", rotulo: "Assinaturas", texto: "Documentos aguardando a sua assinatura e solicitações enviadas.", mostrar: true },
    { href: "/ged/tramite", rotulo: "Trâmite", texto: "Documentos recebidos e enviados a outros setores.", mostrar: true },
    { href: "/ged/pastas", rotulo: "Pastas", texto: "Organização dos documentos por pastas e permissões.", mostrar: true },
    { href: "/ged/logs", rotulo: "Logs", texto: "Acessos, alterações e comunicações.", mostrar: podeVerLogs(ctx) },
    { href: "/ged/admin", rotulo: "Administração", texto: "Setores, membros e configurações.", mostrar: podeGerirEstruturaGed(ctx) },
  ].filter((a) => a.mostrar);

  return (
    <>
      <CabecalhoPagina titulo={NOME_MODULO_GED} subtitulo={`Bem-vindo(a), ${ctx.usuario.nome}.`} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Resumo">
        <Contador valor={total} rotulo="Documentos acessíveis a você" />
        <Contador valor={aAssinar} rotulo="Aguardando a sua assinatura" href="/ged/assinaturas" destaque={aAssinar > 0} />
        <Contador valor={noMeuTramite} rotulo="Em trâmite com você" href="/ged/tramite" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card titulo="Atalhos" className="lg:col-span-2">
          <ul className="grid gap-3 sm:grid-cols-2">
            {atalhos.map((a) => (
              <li key={a.href}>
                <Link href={a.href} prefetch={false} className="block h-full rounded-md border border-slate-200 p-3 hover:border-primaria-600 hover:bg-primaria-50">
                  <span className="font-medium text-primaria-800">{a.rotulo}</span>
                  <span className="mt-1 block text-sm text-slate-600">{a.texto}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card titulo="Atualizados recentemente">
          {recentes.length === 0 ? (
            <p className="text-sm text-slate-600">Nenhum documento ainda.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentes.map((d) => (
                <li key={d.id} className="py-2">
                  <Link href={`/ged/documentos/${d.id}`} prefetch={false} className="font-medium text-primaria-700 hover:underline">{d.titulo}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{d.numero}</span>
                    <Badge cor={COR_STATUS_DOCUMENTO_GED[d.status]}>{ROTULO_STATUS_DOCUMENTO_GED[d.status]}</Badge>
                    <span>{fmtDataHora(d.updated_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Contador({ valor, rotulo, href, destaque }: { valor: number; rotulo: string; href?: string; destaque?: boolean }) {
  const corpo = (
    <div className={`card p-4 ${destaque ? "border-amber-300 bg-amber-50" : ""}`}>
      <div className="text-3xl font-semibold text-slate-900">{valor}</div>
      <div className="text-sm text-slate-600">{rotulo}</div>
    </div>
  );
  return href ? <Link href={href} prefetch={false} className="block hover:opacity-90">{corpo}</Link> : corpo;
}
