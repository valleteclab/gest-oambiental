"use client";
import { useActionState } from "react";
import { acaoExecutarBackup, acaoExecutarRestore, type EstadoExecucao } from "./actions";

function Botao({ acao, rotulo, testid, ocupado }: { acao: (s: EstadoExecucao, f: FormData) => Promise<EstadoExecucao>; rotulo: string; testid: string; ocupado: boolean }) {
  const [estado, executar, pendente] = useActionState(acao, undefined);
  return (
    <form action={executar} className="space-y-1">
      <button className="btn-primario w-full sm:w-auto" disabled={pendente || ocupado} data-testid={testid}>
        {pendente ? "Iniciando…" : ocupado ? "Em execução…" : rotulo}
      </button>
      {estado?.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
      {estado?.ok && <p role="status" className="text-sm text-emerald-700">{estado.ok}</p>}
    </form>
  );
}

export function BotoesExecucao({ backupEmAndamento, restoreEmAndamento }: { backupEmAndamento: boolean; restoreEmAndamento: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
      <Botao acao={acaoExecutarBackup} rotulo="Executar backup agora" testid="executar-backup-agora" ocupado={backupEmAndamento} />
      <Botao acao={acaoExecutarRestore} rotulo="Executar teste de restauração agora" testid="executar-restore-agora" ocupado={restoreEmAndamento} />
    </div>
  );
}
