"use client";
import { useActionState } from "react";
import { definirSenha } from "./actions";

export function FormDefinirSenha({ token, nome }: { token: string; nome: string }) {
  const [estado, acao, pendente] = useActionState(definirSenha, undefined);
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Definir senha</h1>
      <p className="mb-4 text-sm text-slate-600">Olá, {nome}. Escolha a senha de acesso (mínimo de 10 caracteres). Este link só pode ser usado uma vez.</p>
      <form action={acao} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div><label className="label" htmlFor="nova">Nova senha</label><input id="nova" name="nova" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="confirmacao">Confirmar nova senha</label><input id="confirmacao" name="confirmacao" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
        {estado?.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
        <button className="btn-primario w-full" disabled={pendente}>Salvar senha</button>
      </form>
    </>
  );
}
