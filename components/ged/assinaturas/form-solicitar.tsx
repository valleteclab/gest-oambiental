"use client";
import { useMemo, useState } from "react";
import { FormGed } from "@/components/ged/form-ged";
import type { EstadoFormGed } from "@/lib/ged/acoes";

export type CandidatoSignatario = { id: string; nome: string; cargo: string | null; papel: string };
type Acao = (estado: EstadoFormGed, form: FormData) => Promise<EstadoFormGed>;

/** Formulário de solicitação de assinatura: busca por nome, ordem (↑/↓), modo, prazo e mensagem. */
export function FormSolicitarAssinatura({ action, documentoId, candidatos, prazoPadrao }: { action: Acao; documentoId: string; candidatos: CandidatoSignatario[]; prazoPadrao: number }) {
  const [busca, setBusca] = useState("");
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [modo, setModo] = useState<"SEQUENCIAL" | "PARALELO">("SEQUENCIAL");
  const porId = useMemo(() => new Map(candidatos.map((c) => [c.id, c])), [candidatos]);
  const termo = busca.trim().toLowerCase();
  const disponiveis = candidatos.filter((c) => !escolhidos.includes(c.id) && (!termo || c.nome.toLowerCase().includes(termo))).slice(0, 8);
  const mover = (i: number, d: -1 | 1) =>
    setEscolhidos((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <FormGed action={action} botao="Enviar para assinatura" rotuloAcessivel="Solicitar assinatura">
      <input type="hidden" name="documento_id" value={documentoId} />
      {escolhidos.map((id) => <input key={id} type="hidden" name="signatarios" value={id} />)}

      <fieldset className="space-y-2">
        <legend className="label">Signatários</legend>
        {escolhidos.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum signatário escolhido. Busque pelo nome abaixo.</p>
        ) : (
          <ol className="space-y-1" data-testid="signatarios-escolhidos">
            {escolhidos.map((id, i) => (
              <li key={id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm">
                <span className="w-5 text-right font-semibold text-slate-500">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{porId.get(id)?.nome ?? id}</span>
                <span className="flex gap-1">
                  <button type="button" className="btn-secundario btn-sm" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${porId.get(id)?.nome ?? ""}`}>↑</button>
                  <button type="button" className="btn-secundario btn-sm" onClick={() => mover(i, 1)} disabled={i === escolhidos.length - 1} aria-label={`Descer ${porId.get(id)?.nome ?? ""}`}>↓</button>
                  <button type="button" className="btn-secundario btn-sm" onClick={() => setEscolhidos((l) => l.filter((x) => x !== id))} aria-label={`Remover ${porId.get(id)?.nome ?? ""}`}>Remover</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div>
          <label className="label" htmlFor="busca-signatario">Buscar signatário por nome</label>
          <input id="busca-signatario" type="search" className="input" value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} autoComplete="off" placeholder="Digite parte do nome" />
        </div>
        {disponiveis.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200" aria-label="Resultados da busca">
            {disponiveis.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className="min-w-0">{c.nome}{c.cargo ? <span className="text-slate-500"> – {c.cargo}</span> : null}</span>
                <button type="button" className="btn-secundario btn-sm" onClick={() => setEscolhidos((l) => [...l, c.id])} aria-label={`Adicionar ${c.nome}`}>Adicionar</button>
              </li>
            ))}
          </ul>
        ) : termo ? <p className="text-sm text-slate-500">Ninguém encontrado com esse nome.</p> : null}
      </fieldset>

      <fieldset>
        <legend className="label">Modo de assinatura</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="modo" value="SEQUENCIAL" checked={modo === "SEQUENCIAL"} onChange={() => setModo("SEQUENCIAL")} /> Sequencial (na ordem acima)</label>
          <label className="flex items-center gap-2"><input type="radio" name="modo" value="PARALELO" checked={modo === "PARALELO"} onChange={() => setModo("PARALELO")} /> Paralelo (todos ao mesmo tempo)</label>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div>
          <label className="label" htmlFor="prazo-assinatura">Prazo (dias)</label>
          <input id="prazo-assinatura" name="prazo_dias" type="number" min={1} max={90} defaultValue={prazoPadrao} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="mensagem-assinatura">Mensagem aos signatários (opcional)</label>
          <textarea id="mensagem-assinatura" name="mensagem" rows={3} maxLength={1000} className="input" />
        </div>
      </div>
    </FormGed>
  );
}
