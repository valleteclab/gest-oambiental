"use client";
import { useActionState } from "react";
import { entrar } from "./actions";

export type OpcaoOrgao = { sigla: string; rotulo: string };

export function FormLogin({ next, orgaos, orgaoInicial }: { next?: string; orgaos: OpcaoOrgao[]; orgaoInicial?: string }) {
  const [estado, acao, pendente] = useActionState(entrar, undefined);
  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="orgao" className="label">Órgão</label>
        <select
          id="orgao"
          name="orgao"
          required
          className="input"
          key={estado?.orgao ?? orgaoInicial ?? ""}
          defaultValue={estado?.orgao ?? orgaoInicial ?? ""}
          aria-describedby="orgao-ajuda"
        >
          <option value="" disabled>Selecione o órgão…</option>
          {orgaos.map((o) => <option key={o.sigla} value={o.sigla}>{o.rotulo}</option>)}
        </select>
        <p id="orgao-ajuda" className="mt-1 text-xs text-slate-500">Município / órgão ambiental em que você vai atuar.</p>
      </div>
      <div>
        <label htmlFor="email" className="label">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" defaultValue={estado?.email ?? ""} key={`e-${estado?.email ?? ""}`} />
      </div>
      <div>
        <label htmlFor="senha" className="label">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" required className="input" />
      </div>
      {estado?.erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{estado.erro}</p>}
      <button className="btn-primario w-full" disabled={pendente}>{pendente ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
