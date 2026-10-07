import { Badge } from "@/components/ui";
import { ROTULO_STATUS_SOLICITACAO_GED, type GedStatusSolicitacao } from "@/lib/ged/tipos";
import type { SolicitacaoView } from "@/lib/ged/assinaturas/consultas";
import { fmtDataHoraBrasilia } from "@/lib/ged/assinaturas/regras";
import { ChipAssinante } from "./chip-assinante";

const COR_SOL: Record<GedStatusSolicitacao, "verde" | "amarelo" | "vermelho" | "cinza" | "azul"> = {
  ABERTA: "amarelo", CONCLUIDA: "verde", RECUSADA: "vermelho", CANCELADA: "cinza", EXPIRADA: "cinza",
};

export const BadgeSolicitacao = ({ status }: { status: GedStatusSolicitacao }) => <Badge cor={COR_SOL[status]}>{ROTULO_STATUS_SOLICITACAO_GED[status]}</Badge>;

/** Signatários de uma solicitação, em ordem, com estado/data de cada um (e justificativa de recusa). */
export function ListaSignatarios({ s }: { s: SolicitacaoView }) {
  return (
    <ol className="space-y-2" aria-label="Signatários">
      {s.assinantes.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm" data-testid="signatario" data-status={a.status}>
          <span className="w-5 shrink-0 pt-0.5 text-right font-semibold text-slate-500">{a.ordem}.</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.nome}{a.eu ? " (você)" : ""}</span>
              {a.cargo && <span className="text-xs text-slate-500">{a.cargo}</span>}
            </div>
            <div className="mt-1"><ChipAssinante nome={a.rotulo && a.rotulo !== "Assinar" ? a.rotulo : undefined} status={a.status} quando={a.assinado_em ?? a.recusado_em} /></div>
            {a.status === "RECUSADO" && a.justificativa_recusa && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-900"><strong>Justificativa:</strong> {a.justificativa_recusa}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Cabeçalho resumido da solicitação (quem pediu, versão, modo, prazo). */
export function ResumoSolicitacao({ s }: { s: SolicitacaoView }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
      <dt className="text-slate-500">Situação</dt><dd><BadgeSolicitacao status={s.status} /></dd>
      <dt className="text-slate-500">Solicitada por</dt><dd>{s.criada_por_nome} em {fmtDataHoraBrasilia(s.created_at)}</dd>
      <dt className="text-slate-500">Versão</dt><dd>{s.versao_n ? `v${s.versao_n}` : "—"} · modo {s.modo === "SEQUENCIAL" ? "sequencial" : "paralelo"}</dd>
      <dt className="text-slate-500">Prazo</dt><dd>{fmtDataHoraBrasilia(s.prazo_em)}{s.prazo_vencido ? " (vencido)" : ""}</dd>
      {s.concluida_em && (<><dt className="text-slate-500">Encerrada em</dt><dd>{fmtDataHoraBrasilia(s.concluida_em)}</dd></>)}
      {s.mensagem && (<><dt className="text-slate-500">Mensagem</dt><dd className="whitespace-pre-wrap">{s.mensagem}</dd></>)}
    </dl>
  );
}
