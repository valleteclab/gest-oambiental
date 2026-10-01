"use client";
import clsx from "clsx";
import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { acaoCobranca, gerarCobrancaAcao, type EstadoCobranca } from "@/lib/cobranca/actions";

type Acao = (e: EstadoCobranca, f: FormData) => Promise<EstadoCobranca>;

/** Formulário de ação sobre cobrança: envia via Server Action e mostra sucesso/erro. */
function FormCobranca({ action, children, botao, classe = "btn-secundario btn-sm", confirmar, className, testid }: { action: Acao; children: React.ReactNode; botao: string; classe?: string; confirmar?: string; className?: string; testid?: string }) {
  const [estado, enviar, pendente] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado?.ok) ref.current?.reset();
  }, [estado]);
  return (
    <form
      ref={ref}
      className={clsx("space-y-2", className)}
      data-testid={testid}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmar && !window.confirm(confirmar)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => enviar(fd));
      }}
    >
      {children}
      <button className={classe} disabled={pendente}>{pendente ? "Aguarde…" : botao}</button>
      {estado?.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
      {estado?.ok && <p role="status" className="text-sm text-emerald-700">{estado.mensagem}</p>}
    </form>
  );
}

function Oculto({ id, processoId, acao }: { id: string; processoId?: string | null; acao: string }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value={acao} />
      {processoId && <input type="hidden" name="processo_id" value={processoId} />}
    </>
  );
}

function Motivo({ rotulo, placeholder }: { rotulo: string; placeholder?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">{rotulo} <span className="text-red-700" aria-hidden>*</span></label>
      <textarea id={id} name="motivo" className="input" rows={2} minLength={5} maxLength={1000} required placeholder={placeholder} />
    </div>
  );
}

export type CobrancaAcoes = { id: string; numero: string | null; processo_id: string | null; aberta: boolean; simulada: boolean; erroGateway: boolean; gatewayAsaas: boolean; semRegistro: boolean };

/**
 * Ações de uma cobrança (servidor): baixa manual, isenção, cancelamento, nova tentativa no gateway, reenvio ao requerente
 * e simulação de pagamento (homologação). `gerir` = ADMIN/GESTOR_MUNICIPAL do município (checado de novo no servidor).
 */
export function AcoesCobranca({ c, gerir }: { c: CobrancaAcoes; gerir: boolean }) {
  const [painel, setPainel] = useState<"" | "baixa" | "isentar" | "cancelar">("");
  const idData = useId();
  const idForma = useId();
  const idValor = useId();
  const idArq = useId();
  if (!c.aberta || !gerir) return null;
  return (
    <div className="space-y-2" data-testid={`acoes-cobranca-${c.numero}`}>
      <div className="flex flex-wrap gap-2">
        {c.simulada && (
          <FormCobranca action={acaoCobranca} botao="Simular pagamento (homologação)" classe="btn-primario btn-sm" testid="simular-pagamento">
            <Oculto id={c.id} processoId={c.processo_id} acao="simular" />
          </FormCobranca>
        )}
        {c.gatewayAsaas && (c.erroGateway || c.semRegistro) && (
          <FormCobranca action={acaoCobranca} botao="Tentar novamente">
            <Oculto id={c.id} processoId={c.processo_id} acao="tentar" />
          </FormCobranca>
        )}
        <FormCobranca action={acaoCobranca} botao="Reenviar ao requerente">
          <Oculto id={c.id} processoId={c.processo_id} acao="reenviar" />
        </FormCobranca>
        {(["baixa", "isentar", "cancelar"] as const).map((p) => (
          <button key={p} type="button" className={clsx("btn-sm", painel === p ? "btn-primario" : "btn-secundario")} aria-expanded={painel === p} onClick={() => setPainel(painel === p ? "" : p)}>
            {{ baixa: "Baixa manual", isentar: "Isentar", cancelar: "Cancelar" }[p]}
          </button>
        ))}
      </div>
      {painel === "baixa" && (
        <FormCobranca action={acaoCobranca} botao="Registrar baixa" classe="btn-primario btn-sm" className="rounded-md border border-slate-200 p-3" testid="form-baixa">
          <Oculto id={c.id} processoId={c.processo_id} acao="baixa" />
          <Motivo rotulo="Descrição da baixa" placeholder="Pago no caixa da Prefeitura – DAM nº …" />
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor={idForma} className="label">Forma</label>
              <select id={idForma} name="forma" className="input" defaultValue="MANUAL">
                <option value="MANUAL">Baixa manual</option>
                <option value="DAM">Guia (DAM) no banco</option>
                <option value="PIX">Pix direto na conta</option>
                <option value="TRANSFERENCIA">Transferência</option>
                <option value="DINHEIRO">Dinheiro (caixa)</option>
              </select>
            </div>
            <div>
              <label htmlFor={idData} className="label">Data do pagamento</label>
              <input id={idData} type="date" name="pago_em" className="input" />
            </div>
            <div>
              <label htmlFor={idValor} className="label">Valor pago (R$)</label>
              <input id={idValor} name="valor_pago" inputMode="decimal" className="input" placeholder="igual ao da cobrança" />
            </div>
          </div>
          <div>
            <label htmlFor={idArq} className="label">Comprovante (opcional – PDF/JPG/PNG)</label>
            <input id={idArq} type="file" name="comprovante" accept=".pdf,.jpg,.jpeg,.png" className="block text-sm" />
          </div>
        </FormCobranca>
      )}
      {painel === "isentar" && (
        <FormCobranca action={acaoCobranca} botao="Confirmar isenção" classe="btn-primario btn-sm" className="rounded-md border border-slate-200 p-3" confirmar="Isentar esta cobrança? A etapa do processo será liberada.">
          <Oculto id={c.id} processoId={c.processo_id} acao="isentar" />
          <Motivo rotulo="Fundamento da isenção" placeholder="Art. … da Lei Municipal nº … (entidade sem fins lucrativos)" />
        </FormCobranca>
      )}
      {painel === "cancelar" && (
        <FormCobranca action={acaoCobranca} botao="Confirmar cancelamento" classe="btn-perigo btn-sm" className="rounded-md border border-slate-200 p-3" confirmar="Cancelar esta cobrança? Ela também será removida no Asaas.">
          <Oculto id={c.id} processoId={c.processo_id} acao="cancelar" />
          <Motivo rotulo="Motivo do cancelamento" placeholder="Valor incorreto – nova cobrança será gerada" />
        </FormCobranca>
      )}
    </div>
  );
}

/** Requerente (homologação): simular o pagamento da própria cobrança simulada. */
export function SimularPagamentoRequerente({ id, processoId }: { id: string; processoId: string }) {
  return (
    <FormCobranca action={acaoCobranca} botao="Simular pagamento (homologação)" testid="simular-pagamento">
      <Oculto id={id} processoId={processoId} acao="simular" />
    </FormCobranca>
  );
}

/** Gerar cobrança manualmente para uma fase (valor da tabela ou informado). */
export function GerarCobranca({ processoId, fases }: { processoId: string; fases: { valor: string; rotulo: string }[] }) {
  const idFase = useId();
  const idValor = useId();
  return (
    <FormCobranca action={gerarCobrancaAcao} botao="Gerar cobrança" className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto] sm:space-y-0" testid="form-gerar-cobranca">
      <input type="hidden" name="processo_id" value={processoId} />
      <div>
        <label htmlFor={idFase} className="label">Fase</label>
        <select id={idFase} name="fase" className="input" required>
          {fases.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={idValor} className="label">Valor (R$)</label>
        <input id={idValor} name="valor" inputMode="decimal" className="input" placeholder="da tabela" />
      </div>
    </FormCobranca>
  );
}
