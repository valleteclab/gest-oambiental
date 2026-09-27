"use client";
import clsx from "clsx";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { Aviso } from "@/components/ui";

export type EstadoForm = { ok?: boolean; erro?: string; mensagem?: string; campos?: Record<string, string>; extra?: Record<string, string> } | undefined;
type Acao = (estado: EstadoForm, form: FormData) => Promise<EstadoForm>;

/**
 * Formulário genérico do admin: executa a Server Action, mostra sucesso/erro e (opcional) limpa após salvar.
 * Os campos são passados como children (renderizados no servidor).
 */
export function FormAdmin({ action, children, botao = "Salvar", classeBotao = "btn-primario", className, confirmar, limparAoSalvar, inline, rotuloAcessivel }: {
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
      className={clsx(inline ? "inline-flex flex-wrap items-end gap-2" : "space-y-4", className)}
      onSubmit={(e) => {
        // Envio manual (sem action=): evita o reset automático do React 19 que apagaria os campos em caso de erro.
        e.preventDefault();
        if (confirmar && !window.confirm(confirmar)) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => acao(fd));
      }}
    >
      {children}
      <button className={clsx(classeBotao, inline && "btn-sm")} disabled={pendente}>{pendente ? "Aguarde…" : botao}</button>
      {estado?.erro && (
        <div className={inline ? "basis-full" : undefined}>
          <Aviso tipo="erro">
            {estado.erro}
            {estado.campos && (
              <ul className="mt-1 list-inside list-disc">
                {Object.entries(estado.campos).filter(([, m]) => m !== estado.erro).map(([k, m]) => <li key={k}><strong>{k}</strong>: {m}</li>)}
              </ul>
            )}
          </Aviso>
        </div>
      )}
      {estado?.ok && estado.mensagem && (
        <div className={inline ? "basis-full" : undefined}>
          <Aviso tipo="sucesso">
            {estado.mensagem}
            {estado.extra?.senha && (
              <p className="mt-2">
                Senha temporária: <code className="rounded bg-white px-2 py-1 font-mono text-base" data-testid="senha-temporaria">{estado.extra.senha}</code>
                <br /><span className="text-xs">Anote e entregue ao usuário por canal seguro – ela não será exibida novamente. A troca é obrigatória no primeiro acesso.</span>
              </p>
            )}
            {estado.extra?.link && <p className="mt-1"><a className="underline" href={estado.extra.link}>Abrir registro</a></p>}
          </Aviso>
        </div>
      )}
    </form>
  );
}
