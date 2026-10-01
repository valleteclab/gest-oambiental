"use client";
import { useActionState } from "react";
import { trocarOrgao } from "./actions";

export function FormTrocarOrgao({ orgaos, atual, next }: { orgaos: { sigla: string; nome: string; orgao: string; brasao: string }[]; atual?: string; next?: string }) {
  const [estado, acao, pendente] = useActionState(trocarOrgao, undefined);
  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <fieldset>
        <legend className="label">Órgão</legend>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {orgaos.map((o) => (
            <label key={o.sigla} className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 p-3 hover:border-primaria-600 has-[:checked]:border-primaria-600 has-[:checked]:bg-primaria-50">
              <input type="radio" name="orgao" value={o.sigla} defaultChecked={o.sigla === atual} required className="h-4 w-4 accent-primaria-700" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.brasao} alt="" className="h-8 w-8 shrink-0 object-contain" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{o.nome}</span>
                <span className="block truncate text-xs text-slate-600">{o.orgao}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {estado?.erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{estado.erro}</p>}
      <button className="btn-primario w-full" disabled={pendente}>{pendente ? "Trocando…" : "Usar este órgão"}</button>
    </form>
  );
}
