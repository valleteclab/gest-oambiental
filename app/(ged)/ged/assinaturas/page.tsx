import clsx from "clsx";
import Link from "next/link";
import { Badge, CabecalhoPagina, Card, Paginacao, PontoSemaforo, Vazio } from "@/components/ui";
import { ChipAssinante } from "@/components/ged/assinaturas/chip-assinante";
import { BadgeSolicitacao } from "@/components/ged/assinaturas/linha-tempo";
import { ABAS_PAINEL, painelAssinaturas, ROTULO_ABA, type AbaPainel, type LinhaPainel } from "@/lib/ged/assinaturas/consultas";
import { fmtDataHoraBrasilia } from "@/lib/ged/assinaturas/regras";
import { exigirGed } from "@/lib/ged/escopo";
import { ROTULO_STATUS_SOLICITACAO_GED } from "@/lib/ged/tipos";
import { semaforo } from "@/lib/dias";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assinaturas – Gestão de Documentos" };

type SP = { aba?: string; page?: string; q?: string; status?: string };
const STATUS_FILTRO = ["ABERTA", "CONCLUIDA", "RECUSADA", "EXPIRADA", "CANCELADA"] as const;

export default async function PainelAssinaturas({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await exigirGed();
  const sp = await searchParams;
  const aba: AbaPainel = (ABAS_PAINEL as readonly string[]).includes(sp.aba ?? "") ? (sp.aba as AbaPainel) : "aguardando";
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").slice(0, 100);
  const status = aba === "enviadas" && (STATUS_FILTRO as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUS_FILTRO)[number]) : undefined;
  const { linhas, total, size } = await painelAssinaturas(ctx, { aba, page, q, status, size: 15 });

  const href = (p: Partial<SP>) => {
    const u = new URLSearchParams();
    const m = { aba, q, status, page: undefined, ...p } as SP;
    for (const [k, v] of Object.entries(m)) if (v) u.set(k, String(v));
    return `/ged/assinaturas?${u.toString()}`;
  };

  return (
    <>
      <CabecalhoPagina titulo="Assinaturas" subtitulo="Documentos que aguardam a sua assinatura e solicitações acompanhadas por você." />
      <div role="tablist" aria-label="Situação das assinaturas" className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
        {ABAS_PAINEL.map((a) => (
          <Link
            key={a}
            role="tab"
            aria-selected={a === aba}
            href={href({ aba: a, q: undefined, status: undefined })}
            prefetch={false}
            className={clsx("-mb-px whitespace-nowrap rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium", a === aba ? "border-slate-200 bg-white text-primaria-800" : "border-transparent text-slate-600 hover:bg-slate-100")}
          >
            {ROTULO_ABA[a]}
          </Link>
        ))}
      </div>

      <form method="get" action="/ged/assinaturas" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filtrar assinaturas">
        <input type="hidden" name="aba" value={aba} />
        <div className="min-w-0 flex-1 basis-56">
          <label className="label" htmlFor="filtro-q">Documento (título ou número)</label>
          <input id="filtro-q" name="q" defaultValue={q} className="input" maxLength={100} />
        </div>
        {aba === "enviadas" && (
          <div>
            <label className="label" htmlFor="filtro-status">Situação</label>
            <select id="filtro-status" name="status" defaultValue={status ?? ""} className="input">
              <option value="">Todas</option>
              {STATUS_FILTRO.map((s) => <option key={s} value={s}>{ROTULO_STATUS_SOLICITACAO_GED[s]}</option>)}
            </select>
          </div>
        )}
        <button className="btn-secundario">Filtrar</button>
      </form>

      <Card>
        {linhas.length === 0 ? (
          <Vazio>Nenhuma solicitação nesta aba.</Vazio>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="lista-assinaturas">
            {linhas.map((l) => <LinhaSolicitacao key={l.id} l={l} />)}
          </ul>
        )}
        <Paginacao page={page} size={size} total={total} href={(p) => href({ page: String(p) as never })} />
      </Card>
    </>
  );
}

function LinhaSolicitacao({ l }: { l: LinhaPainel }) {
  const sem = l.status === "ABERTA" ? semaforo(l.prazo_em, 3) : "cinza";
  return (
    <li className="py-3" data-testid="linha-assinatura">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link href={`/ged/documentos/${l.documento.id}?aba=assinaturas`} className="break-words font-medium text-primaria-700 underline">{l.documento.titulo}</Link>
          <div className="text-xs text-slate-500">{l.documento.numero} · solicitada por {l.criada_por_nome} em {fmtDataHoraBrasilia(l.created_at)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BadgeSolicitacao status={l.status} />
          {l.status === "ABERTA" && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-600"><PontoSemaforo s={sem} titulo={`Prazo: ${fmtDataHoraBrasilia(l.prazo_em)}`} /> prazo {fmtDataHoraBrasilia(l.prazo_em).slice(0, 10)}</span>
          )}
          {l.selo_pendente && <Badge cor="amarelo">Selo pendente</Badge>}
          {l.minha_vez && <Link href={`/ged/assinaturas/${l.id}`} className="btn-primario btn-sm">Assinar</Link>}
          {!l.minha_vez && <Link href={`/ged/assinaturas/${l.id}`} className="btn-secundario btn-sm">Detalhes</Link>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Situação por signatário">
        {l.assinantes.map((a) => <ChipAssinante key={a.id} nome={a.nome} status={a.status} quando={a.assinado_em ?? a.recusado_em} />)}
      </div>
    </li>
  );
}
