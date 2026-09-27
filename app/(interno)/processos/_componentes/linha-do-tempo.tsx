import type { StatusProcesso } from "@prisma/client";
import { fmtDataHora } from "@/lib/format";
import { ROTULO_STATUS, statusAmigavel, Vazio } from "@/components/ui";
import { ROTULO_ACAO, normalizarAcao } from "@/lib/processo/maquina";

export type ItemLinha = { id: string; acao: string; de_status: StatusProcesso | null; para_status: StatusProcesso; despacho: string | null; publico: boolean; created_at: Date; de_usuario?: string | null; para_usuario?: string | null };

const rotuloAcao = (a: string) => {
  const n = normalizarAcao(a);
  return n ? ROTULO_ACAO[n] : a === "criar" ? "Rascunho criado" : a;
};

/** Linha do tempo: interna (data, usuário, despacho) ou pública/requerente (status amigável, sem despachos internos). */
export function LinhaDoTempo({ itens, publica = false }: { itens: ItemLinha[]; publica?: boolean }) {
  if (!itens.length) return <Vazio>Nenhuma movimentação registrada.</Vazio>;
  return (
    <ol className="relative ml-2 border-l-2 border-primaria-100" data-testid="linha-do-tempo">
      {itens.map((t) => (
        <li key={t.id} className="mb-5 ml-5">
          <span className="absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white bg-primaria-600" aria-hidden />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <time className="text-xs font-medium text-slate-500" dateTime={t.created_at.toISOString()}>{fmtDataHora(t.created_at)}</time>
            <span className="font-semibold text-slate-900">{publica ? statusAmigavel(t.para_status) : rotuloAcao(t.acao)}</span>
            {!publica && (
              <span className="text-xs text-slate-600">
                {t.de_status ? `${ROTULO_STATUS[t.de_status]} → ` : ""}
                {ROTULO_STATUS[t.para_status]}
                {!t.publico && " · interno"}
              </span>
            )}
          </div>
          {!publica && (
            <p className="text-xs text-slate-600">
              por <strong>{t.de_usuario ?? "Sistema"}</strong>
              {t.para_usuario ? <> · para <strong>{t.para_usuario}</strong></> : null}
            </p>
          )}
          {publica && <p className="text-xs text-slate-600">{rotuloAcao(t.acao)}</p>}
          {!publica && t.despacho && <p className="mt-1 whitespace-pre-line rounded-md bg-slate-50 p-2 text-sm text-slate-800">{t.despacho}</p>}
        </li>
      ))}
    </ol>
  );
}
