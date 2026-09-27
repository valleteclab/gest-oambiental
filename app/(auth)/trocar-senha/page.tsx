"use client";
import { useActionState } from "react";
import { trocarSenha } from "./actions";

export default function PaginaTrocarSenha() {
  const [estado, acao, pendente] = useActionState(trocarSenha, undefined);
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Trocar senha</h1>
      <p className="mb-4 text-sm text-slate-600">Por segurança, defina uma nova senha (mínimo de 10 caracteres).</p>
      <form action={acao} className="space-y-4">
        <div><label className="label" htmlFor="atual">Senha atual</label><input id="atual" name="atual" type="password" required className="input" autoComplete="current-password" /></div>
        <div><label className="label" htmlFor="nova">Nova senha</label><input id="nova" name="nova" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="confirmacao">Confirmar nova senha</label><input id="confirmacao" name="confirmacao" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
        {estado?.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
        <button className="btn-primario w-full" disabled={pendente}>Salvar</button>
      </form>
    </>
  );
}
