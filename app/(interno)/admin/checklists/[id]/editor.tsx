"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Aviso } from "@/components/ui";
import { salvarChecklist } from "../actions";
import { useFormAcao } from "../../../pessoas/_form/campos";

type Item = { id: string; texto: string; tipo: "SIM_NAO" | "TEXTO" | "NUMERO"; obrigatorio: boolean };
const TIPOS = [{ v: "SIM_NAO", r: "Sim/Não" }, { v: "TEXTO", r: "Texto" }, { v: "NUMERO", r: "Número" }] as const;

export function EditorChecklist({ id, nome, itens: inicial }: { id?: string; nome?: string; itens: Item[] }) {
  const [estado, onSubmit, pendente] = useFormAcao(salvarChecklist);
  const [itens, setItens] = useState<Item[]>(inicial.length ? inicial : [{ id: "c1", texto: "", tipo: "SIM_NAO", obrigatorio: true }]);
  const upd = (i: number, p: Partial<Item>) => setItens((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const mover = (i: number, d: number) => setItens((l) => { const n = [...l]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const novoId = () => { let k = itens.length + 1; while (itens.some((x) => x.id === `c${k}`)) k++; return `c${k}`; };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="itens" value={JSON.stringify(itens)} />
      <div>
        <label htmlFor="ck-nome" className="label">Nome do checklist <span className="text-red-700" aria-hidden>*</span></label>
        <input id="ck-nome" name="nome" defaultValue={nome} required className="input" />
      </div>
      <fieldset>
        <legend className="label">Itens</legend>
        <ol className="space-y-2">
          {itens.map((it, i) => (
            <li key={it.id} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[3rem_1fr_9rem_auto_auto] sm:items-center">
              <span className="font-mono text-xs text-slate-500">{it.id}</span>
              <label className="sr-only" htmlFor={`ck-t-${it.id}`}>Texto do item {i + 1}</label>
              <input id={`ck-t-${it.id}`} className="input" value={it.texto} onChange={(e) => upd(i, { texto: e.target.value })} placeholder="Descrição do item" />
              <label className="sr-only" htmlFor={`ck-tipo-${it.id}`}>Tipo de resposta do item {i + 1}</label>
              <select id={`ck-tipo-${it.id}`} className="input" value={it.tipo} onChange={(e) => upd(i, { tipo: e.target.value as Item["tipo"] })}>
                {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
              </select>
              <label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={it.obrigatorio} onChange={(e) => upd(i, { obrigatorio: e.target.checked })} /> Obrigatório</label>
              <div className="flex gap-1">
                <button type="button" className="btn-secundario btn-sm" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Subir item ${i + 1}`}><ArrowUp className="h-3 w-3" /></button>
                <button type="button" className="btn-secundario btn-sm" disabled={i === itens.length - 1} onClick={() => mover(i, 1)} aria-label={`Descer item ${i + 1}`}><ArrowDown className="h-3 w-3" /></button>
                <button type="button" className="btn-secundario btn-sm" onClick={() => setItens((l) => l.filter((_, j) => j !== i))} aria-label={`Remover item ${i + 1}`}><Trash2 className="h-3 w-3" /></button>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn-secundario btn-sm mt-2" onClick={() => setItens((l) => [...l, { id: novoId(), texto: "", tipo: "SIM_NAO", obrigatorio: false }])}>+ Adicionar item</button>
      </fieldset>
      {estado?.erro && <Aviso tipo="erro">{estado.erro}{estado.campos?.itens && estado.campos.itens !== estado.erro ? ` – ${estado.campos.itens}` : ""}</Aviso>}
      {estado?.ok && <Aviso tipo="sucesso">{estado.mensagem} {estado.extra?.link && <a className="underline" href={estado.extra.link}>Abrir</a>}</Aviso>}
      <button className="btn-primario" disabled={pendente}>{pendente ? "Salvando…" : "Salvar checklist"}</button>
    </form>
  );
}
