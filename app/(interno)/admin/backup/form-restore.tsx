"use client";
import { useActionState } from "react";
import { acaoRegistrarRestore } from "./actions";

export function FormRestore() {
  const [estado, acao, pendente] = useActionState(acaoRegistrarRestore, undefined);
  return (
    <form action={acao} className="space-y-3" data-testid="form-restore">
      <label className="block">
        <span className="label">Observação do teste</span>
        <textarea name="observacao" required minLength={10} rows={3} className="input" placeholder="Ex.: dump de 27/09 restaurado em banco descartável; contagens conferidas (processo=…, usuario=…); login e validação de documento OK." />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Resultado</span>
          <select name="sucesso" className="input" defaultValue="true">
            <option value="true">Sucesso</option>
            <option value="false">Falhou</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Ambiente/banco de restauração</span>
          <input name="destino" className="input" placeholder="licenciagov_restore_teste" />
        </label>
      </div>
      {estado?.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
      {estado?.ok && <p role="status" className="text-sm text-emerald-700">Teste de restauração registrado.</p>}
      <button className="btn-primario" disabled={pendente}>{pendente ? "Registrando…" : "Registrar teste de restauração"}</button>
    </form>
  );
}
