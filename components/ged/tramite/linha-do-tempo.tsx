import clsx from "clsx";
import { Badge, PontoSemaforo } from "@/components/ui";
import type { EventoTramiteView } from "@/lib/ged/tramite/consultas";
import { COR_TIPO_TRAMITE, fmtDataHoraBR } from "@/lib/ged/tramite/regras";
import { ROTULO_TIPO_TRAMITE_GED } from "@/lib/ged/tipos";

const PONTO: Record<string, string> = { azul: "bg-sky-500", cinza: "bg-slate-400", verde: "bg-emerald-500", amarelo: "bg-amber-500", vermelho: "bg-red-600", roxo: "bg-violet-500" };

const parte = (nome: string | null, setor: string | null) => (nome && setor ? `${nome} (${setor})` : (nome ?? setor ?? null));

/** Linha do tempo (imutável) do trâmite do documento: mais recente primeiro. Sem estado: serve a Server Components. */
export function LinhaDoTempoTramite({ eventos }: { eventos: EventoTramiteView[] }) {
  if (eventos.length === 0) return <p className="py-4 text-sm text-slate-600">Este documento ainda não foi tramitado.</p>;
  const ordem = [...eventos].reverse();
  return (
    <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5" aria-label="Histórico de trâmite" data-testid="linha-do-tempo">
      {ordem.map((e) => {
        const cor = COR_TIPO_TRAMITE[e.tipo];
        const de = parte(e.de_nome, e.de_setor_nome);
        const para = parte(e.para_nome, e.para_setor_nome);
        return (
          <li key={e.id} className="relative" data-tipo={e.tipo}>
            <span className={clsx("absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-2 ring-white", PONTO[cor])} aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge cor={cor}>{ROTULO_TIPO_TRAMITE_GED[e.tipo]}</Badge>
              <time className="text-xs text-slate-600" dateTime={e.created_at.toISOString()}>{fmtDataHoraBR(e.created_at)}</time>
            </div>
            <p className="mt-1 break-words text-sm text-slate-800">
              {de && <span className="font-medium">{de}</span>}
              {para && (
                <>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> para </span>
                  <span className="font-medium">{para}</span>
                </>
              )}
            </p>
            {e.despacho && <p className="mt-1 whitespace-pre-line break-words rounded bg-slate-50 px-3 py-2 text-sm text-slate-800">{e.despacho}</p>}
            {e.tipo === "ENVIO" && e.prazo_em && (
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                <PontoSemaforo s={e.semaforo} />
                Prazo: {fmtDataHoraBR(e.prazo_em)}
              </p>
            )}
            {e.ciencia && (
              <p className={clsx("mt-1 text-xs", e.ciencia.dada ? "text-emerald-800" : "text-amber-800")}>
                {e.ciencia.dada ? `Ciência de ${e.ciencia.por_nome ?? "destinatário"} em ${fmtDataHoraBR(e.ciencia.em)}` : "Aguardando ciência do destinatário"}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
