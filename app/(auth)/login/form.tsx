"use client";
import { useActionState } from "react";
import { entrar } from "./actions";

export type OpcaoOrgao = { sigla: string; rotulo: string; grupo?: string };

export function FormLogin({ next, orgaos, orgaoInicial }: { next?: string; orgaos: OpcaoOrgao[]; orgaoInicial?: string }) {
  const [estado, acao, pendente] = useActionState(entrar, undefined);
  // Agrupa por organização (cliente) quando há mais de uma; senão, lista simples.
  const grupos = [...new Set(orgaos.map((o) => o.grupo ?? ""))];
  const opcao = (o: OpcaoOrgao) => <option key={o.sigla} value={o.sigla}>{o.rotulo}</option>;
  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="orgao" className="label">Órgão</label>
        <select
          id="orgao"
          name="orgao"
          className="input"
          key={estado?.orgao ?? orgaoInicial ?? ""}
          defaultValue={estado?.orgao ?? orgaoInicial ?? ""}
          aria-describedby="orgao-ajuda"
        >
          <option value="">Escolher depois de entrar</option>
          {grupos.length > 1 ? grupos.map((g) => <optgroup key={g} label={g || "Outros"}>{orgaos.filter((o) => (o.grupo ?? "") === g).map(opcao)}</optgroup>) : orgaos.map(opcao)}
        </select>
        <p id="orgao-ajuda" className="mt-1 text-xs text-slate-500">Município / órgão ambiental em que você vai atuar. Se deixar para depois, aparecem só os órgãos do seu usuário.</p>
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
