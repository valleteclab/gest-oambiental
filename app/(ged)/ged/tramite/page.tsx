import clsx from "clsx";
import Link from "next/link";
import { Badge, CabecalhoPagina, Card, Paginacao, PontoSemaforo, Vazio } from "@/components/ui";
import { exigirGed } from "@/lib/ged/escopo";
import { rotuloDiasRestantes } from "@/lib/dias";
import {
  aplicarFiltroEntrada, aplicarFiltroEnviados, carregarCaixaEntrada, carregarEnviados, FILTROS_ENTRADA, FILTROS_ENVIADOS,
  type FiltroEntrada, type FiltroEnviados,
} from "@/lib/ged/tramite/consultas";
import { fmtDataHoraBR } from "@/lib/ged/tramite/regras";
import { COR_STATUS_DOCUMENTO_GED, ROTULO_STATUS_DOCUMENTO_GED } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trâmite" };

const TAMANHO = 15;
type Busca = { aba?: string; filtro?: string; q?: string; page?: string };

export default async function PaginaTramite({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirGed();
  const sp = await searchParams;
  const aba = sp.aba === "enviados" ? "enviados" : "entrada";
  const q = (sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);

  const [entradaTodos, enviadosTodos] = await Promise.all([carregarCaixaEntrada(ctx, q), carregarEnviados(ctx, q)]);
  const pendentes = entradaTodos.filter((i) => i.ciencia_pendente).length;
  const semCiencia = enviadosTodos.filter((i) => !i.ciencia.dada).length;

  const filtrosValidos = aba === "entrada" ? FILTROS_ENTRADA.map((f) => f.valor as string) : FILTROS_ENVIADOS.map((f) => f.valor as string);
  const filtro = filtrosValidos.includes(sp.filtro ?? "") ? (sp.filtro as string) : "todos";
  const href = (over: Partial<Busca>) => {
    const p = new URLSearchParams();
    const v = { aba, filtro, q, page: String(page), ...over };
    for (const [k, val] of Object.entries(v)) if (val && !(k === "filtro" && val === "todos") && !(k === "page" && val === "1") && !(k === "aba" && val === "entrada")) p.set(k, String(val));
    const s = p.toString();
    return `/ged/tramite${s ? `?${s}` : ""}`;
  };

  const entrada = aba === "entrada" ? aplicarFiltroEntrada(entradaTodos, filtro as FiltroEntrada) : [];
  const enviados = aba === "enviados" ? aplicarFiltroEnviados(enviadosTodos, filtro as FiltroEnviados) : [];
  const total = aba === "entrada" ? entrada.length : enviados.length;
  const ini = (page - 1) * TAMANHO;

  return (
    <>
      <CabecalhoPagina titulo="Trâmite" subtitulo="Documentos recebidos por você ou pelos seus setores e documentos que você enviou." />
      <nav aria-label="Caixas de trâmite" className="mb-4 flex flex-wrap gap-2">
        {[
          { id: "entrada", rotulo: "Caixa de entrada", n: entradaTodos.length, alerta: pendentes },
          { id: "enviados", rotulo: "Enviados por mim", n: enviadosTodos.length, alerta: semCiencia },
        ].map((t) => (
          <Link
            key={t.id}
            href={`/ged/tramite${t.id === "enviados" ? "?aba=enviados" : ""}`}
            prefetch={false}
            aria-current={aba === t.id ? "page" : undefined}
            className={clsx("inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium", aba === t.id ? "border-primaria-700 bg-primaria-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100")}
          >
            {t.rotulo}
            <span className={clsx("rounded-full px-2 text-xs", aba === t.id ? "bg-white/20" : "bg-slate-100")} data-testid={`contador-${t.id}`}>{t.n}</span>
            {t.alerta > 0 && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-900" title={t.id === "entrada" ? "Aguardando a sua ciência" : "Sem ciência do destinatário"}>{t.alerta} {t.id === "entrada" ? "a confirmar" : "sem ciência"}</span>}
          </Link>
        ))}
      </nav>

      <form method="get" action="/ged/tramite" className="mb-4 flex flex-wrap items-end gap-3" role="search" aria-label="Filtrar caixa">
        {aba === "enviados" && <input type="hidden" name="aba" value="enviados" />}
        <div className="min-w-0 flex-1 basis-56">
          <label className="label" htmlFor="q">Buscar por título ou número</label>
          <input id="q" name="q" defaultValue={q} className="input" maxLength={100} />
        </div>
        <div>
          <label className="label" htmlFor="filtro">Situação</label>
          <select id="filtro" name="filtro" defaultValue={filtro} className="input">
            {(aba === "entrada" ? FILTROS_ENTRADA : FILTROS_ENVIADOS).map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
          </select>
        </div>
        <button className="btn-secundario">Filtrar</button>
      </form>

      <Card>
        {total === 0 ? (
          <Vazio>{aba === "entrada" ? "Nenhum documento na sua caixa de entrada." : "Você ainda não enviou documentos por trâmite."}</Vazio>
        ) : aba === "entrada" ? (
          <ul className="divide-y divide-slate-100" data-testid="caixa-entrada">
            {entrada.slice(ini, ini + TAMANHO).map((i) => (
              <li key={i.documento_id} className="py-3" data-ciencia-pendente={i.ciencia_pendente}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/ged/documentos/${i.documento_id}?aba=tramite`} prefetch={false} className="font-medium text-primaria-700 hover:underline">{i.titulo}</Link>
                  <span className="text-xs text-slate-500">{i.numero}</span>
                  <Badge cor={COR_STATUS_DOCUMENTO_GED[i.status]}>{ROTULO_STATUS_DOCUMENTO_GED[i.status]}</Badge>
                  {i.ciencia_pendente && <Badge cor="amarelo">Ciência pendente</Badge>}
                  {i.via_setor && <Badge cor="cinza">Via setor</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {i.recebido_em ? `Recebido em ${fmtDataHoraBR(i.recebido_em)}` : "Recebido"}
                  {i.remetente_nome ? ` de ${i.remetente_nome}` : ""}
                </p>
                {i.despacho && <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-sm text-slate-700">{i.despacho}</p>}
                {i.prazo_em && (
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                    <PontoSemaforo s={i.semaforo} />
                    Prazo: {fmtDataHoraBR(i.prazo_em)}{i.dias !== null ? ` (${rotuloDiasRestantes(i.dias)})` : " – ciência registrada"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="caixa-enviados">
            {enviados.slice(ini, ini + TAMANHO).map((i) => (
              <li key={i.tramite_id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/ged/documentos/${i.documento_id}?aba=tramite`} prefetch={false} className="font-medium text-primaria-700 hover:underline">{i.titulo}</Link>
                  <span className="text-xs text-slate-500">{i.numero}</span>
                  {i.ciencia.dada ? <Badge cor="verde">Ciência dada</Badge> : <Badge cor="amarelo">Sem ciência</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Enviado em {fmtDataHoraBR(i.enviado_em)} para {[i.para_nome, i.para_setor_nome && `setor ${i.para_setor_nome}`].filter(Boolean).join(" · ")}
                  {i.ciencia.dada && i.ciencia.em ? ` · ciência de ${i.ciencia.por_nome ?? "destinatário"} em ${fmtDataHoraBR(i.ciencia.em)}` : ""}
                </p>
                {i.despacho && <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-sm text-slate-700">{i.despacho}</p>}
                {i.prazo_em && (
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                    <PontoSemaforo s={i.semaforo} />
                    Prazo: {fmtDataHoraBR(i.prazo_em)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <Paginacao page={page} size={TAMANHO} total={total} href={(p) => href({ page: String(p) })} />
      </Card>
    </>
  );
}
