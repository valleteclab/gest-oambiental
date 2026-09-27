"use client";
import { useActionState } from "react";
import { entrar } from "./actions";

export function FormLogin({ next }: { next?: string }) {
  const [estado, acao, pendente] = useActionState(entrar, undefined);
  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="email" className="label">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label htmlFor="senha" className="label">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" required className="input" />
      </div>
      {estado?.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
      <button className="btn-primario w-full" disabled={pendente}>{pendente ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
