"use client";
import { useActionState } from "react";
import { acaoSincronizar } from "../actions";

export function BotaoSincronizar({ municipioId, emAndamento }: { municipioId: string; emAndamento: boolean }) {
  const [estado, executar, pendente] = useActionState(acaoSincronizar, undefined);
  return (
    <form action={executar} className="flex flex-col items-start gap-1 sm:items-end">
      <input type="hidden" name="municipio_id" value={municipioId} />
      <button className="btn-primario" disabled={pendente || emAndamento} data-testid="sincronizar-agora">
        {pendente ? "Iniciando…" : emAndamento ? "Sincronizando…" : "Sincronizar agora"}
      </button>
      {estado?.erro && <p role="alert" className="max-w-sm text-sm text-red-700">{estado.erro}</p>}
      {estado?.ok && <p role="status" className="max-w-sm text-sm text-emerald-700">{estado.ok}</p>}
    </form>
  );
}
