"use client";
import clsx from "clsx";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { Aviso } from "@/components/ui";
import type { EstadoFormGed } from "@/lib/ged/acoes";

type Acao = (estado: EstadoFormGed, form: FormData) => Promise<EstadoFormGed>;

/** Formulário de Server Action do GED: mostra erro/sucesso, limpa ao salvar (opcional) e não apaga campos em caso de erro. */
export function FormGed({ action, children, botao = "Salvar", classeBotao = "btn-primario", className, confirmar, limparAoSalvar, inline, rotuloAcessivel }: {
  action: Acao;
  children?: React.ReactNode;
  botao?: string;
  classeBotao?: string;
  className?: string;
  confirmar?: string;
  limparAoSalvar?: boolean;
  inline?: boolean;
  rotuloAcessivel?: string;
}) {
  const [estado, acao, pendente] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado?.ok && limparAoSalvar) ref.current?.reset();
  }, [estado, limparAoSalvar]);
  return (
    <form
      ref={ref}
      aria-label={rotuloAcessivel}
      className={clsx(inline ? "flex flex-wrap items-end gap-2" : "space-y-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmar && !window.confirm(confirmar)) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => acao(fd));
      }}
    >
      {children}
      <button className={clsx(classeBotao, inline && "btn-sm")} disabled={pendente}>{pendente ? "Aguarde…" : botao}</button>
      {estado?.erro && <div className={inline ? "basis-full" : undefined}><Aviso tipo="erro">{estado.erro}</Aviso></div>}
      {estado?.ok && estado.mensagem && <div className={inline ? "basis-full" : undefined}><Aviso tipo="sucesso">{estado.mensagem}</Aviso></div>}
    </form>
  );
}
