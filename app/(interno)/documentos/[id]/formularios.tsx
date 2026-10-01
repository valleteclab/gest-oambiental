"use client";
import { useActionState } from "react";
import Link from "next/link";
import { acaoCancelar, acaoSubstituir, type EstadoAcao } from "../actions";
import { Aviso } from "@/components/ui";

function Resultado({ estado }: { estado: EstadoAcao }) {
  if (!estado) return null;
  return (
    <div className="mt-3">
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.ok && (
        <Aviso tipo="sucesso">
          {estado.ok} {estado.novoId && <Link className="font-semibold underline" href={`/documentos/${estado.novoId}`}>Abrir substituto</Link>}
        </Aviso>
      )}
    </div>
  );
}

export function FormCancelar({ id }: { id: string }) {
  const [estado, acao, pendente] = useActionState(acaoCancelar, null);
  return (
    <form action={acao} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <label className="block" htmlFor="motivo-cancelar">
        <span className="label">Motivo do cancelamento (obrigatório)</span>
        <textarea id="motivo-cancelar" name="motivo" required minLength={5} rows={3} className="input" placeholder="Ex.: emitido com erro material no endereço do empreendimento" />
      </label>
      <button type="submit" className="btn-perigo" disabled={pendente} data-testid="btn-cancelar-documento"
        onClick={(e) => { if (!confirm("Cancelar este documento? A ação é irreversível e ficará registrada na auditoria.")) e.preventDefault(); }}>
        {pendente ? "Cancelando…" : "Cancelar documento"}
      </button>
      <Resultado estado={estado} />
    </form>
  );
}

export function FormSubstituir({ id, temValidade }: { id: string; temValidade: boolean }) {
  const [estado, acao, pendente] = useActionState(acaoSubstituir, null);
  return (
    <form action={acao} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <label className="block" htmlFor="motivo-substituir">
        <span className="label">Motivo da substituição (obrigatório)</span>
        <textarea id="motivo-substituir" name="motivo" required minLength={5} rows={3} className="input" placeholder="Ex.: correção da razão social do titular" />
      </label>
      {temValidade && (
        <label className="block" htmlFor="validade-sub">
          <span className="label">Nova validade (opcional – mantém a atual se vazio)</span>
          <input id="validade-sub" type="date" name="validade_ate" className="input max-w-xs" />
        </label>
      )}
      <button type="submit" className="btn-secundario" disabled={pendente}>{pendente ? "Emitindo…" : "Emitir substituto"}</button>
      <Resultado estado={estado} />
    </form>
  );
}
