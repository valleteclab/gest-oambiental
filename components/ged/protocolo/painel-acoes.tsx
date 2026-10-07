"use client";
// Ações de andamento do protocolo (o servidor decide quais mostrar pela situação e pela permissão; o serviço checa de novo).
import { FormGed } from "@/components/ged/form-ged";
import { acaoProtocoloAction, emitirComprovanteAction } from "@/app/(ged)/ged/protocolo/actions";
import type { AcaoProtocolo } from "@/lib/ged/protocolo/regras";

type Opcoes = { setores: { id: string; nome: string; sigla: string }[]; usuarios: { id: string; nome: string; cargo: string | null }[] };

function Painel({ titulo, children, aberto }: { titulo: string; children: React.ReactNode; aberto?: boolean }) {
  return (
    <details className="rounded-md border border-slate-200 bg-white" open={aberto}>
      <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primaria-600">{titulo}</summary>
      <div className="border-t border-slate-100 p-3">{children}</div>
    </details>
  );
}

const Texto = ({ id, rotulo, obrigatorio, dica }: { id: string; rotulo: string; obrigatorio?: boolean; dica?: string }) => (
  <div>
    <label className="label" htmlFor={id}>{rotulo}{obrigatorio ? " *" : " (opcional)"}</label>
    <textarea id={id} name="texto" className="input min-h-20" rows={3} maxLength={4000} required={obrigatorio} />
    {dica && <p className="mt-1 text-xs text-amber-700">{dica}</p>}
  </div>
);

export function PainelAcoesProtocolo({ id, acoes, opcoes, semComprovante }: { id: string; acoes: readonly AcaoProtocolo[]; opcoes: Opcoes; semComprovante: boolean }) {
  const tem = (a: AcaoProtocolo) => acoes.includes(a);
  const ocultos = (acao: AcaoProtocolo) => (<><input type="hidden" name="id" value={id} /><input type="hidden" name="acao" value={acao} /></>);
  return (
    <div className="space-y-2" data-testid="acoes-protocolo">
      {tem("ANALISAR") && (
        <Painel titulo="Iniciar análise">
          <FormGed action={acaoProtocoloAction} botao="Assumir e iniciar análise" rotuloAcessivel="Iniciar análise">
            {ocultos("ANALISAR")}
            <p className="text-sm text-slate-600">Você passa a ser o responsável pelo protocolo e a situação muda para &ldquo;Em análise&rdquo;.</p>
            <Texto id="txt-analisar" rotulo="Observação" />
          </FormGed>
        </Painel>
      )}
      {tem("ENCAMINHAR") && (
        <Painel titulo="Encaminhar">
          <FormGed action={acaoProtocoloAction} botao="Encaminhar" rotuloAcessivel="Encaminhar protocolo">
            {ocultos("ENCAMINHAR")}
            <div>
              <label className="label" htmlFor="destino-enc">Destino *</label>
              <select id="destino-enc" name="destino" className="input" required defaultValue="">
                <option value="" disabled>Selecione…</option>
                {opcoes.setores.length > 0 && <optgroup label="Setores">{opcoes.setores.map((s) => <option key={s.id} value={`SETOR:${s.id}`}>{s.nome} ({s.sigla})</option>)}</optgroup>}
                {opcoes.usuarios.length > 0 && <optgroup label="Pessoas">{opcoes.usuarios.map((u) => <option key={u.id} value={`USUARIO:${u.id}`}>{u.nome}{u.cargo ? ` – ${u.cargo}` : ""}</option>)}</optgroup>}
              </select>
            </div>
            <Texto id="txt-encaminhar" rotulo="Despacho (interno)" />
          </FormGed>
        </Painel>
      )}
      {tem("RESPONDER") && (
        <Painel titulo="Responder">
          <FormGed action={acaoProtocoloAction} botao="Registrar resposta" rotuloAcessivel="Responder protocolo">
            {ocultos("RESPONDER")}
            <Texto id="txt-responder" rotulo="Resposta" obrigatorio dica="Este texto é mostrado ao interessado na consulta pública. Não inclua dados pessoais de terceiros." />
            <div>
              <label className="label" htmlFor="arq-responder">Arquivo da resposta em PDF (opcional)</label>
              <input id="arq-responder" name="arquivo" type="file" accept="application/pdf,.pdf" className="input" />
            </div>
          </FormGed>
        </Painel>
      )}
      {tem("DEVOLVER") && (
        <Painel titulo="Devolver ao interessado">
          <FormGed action={acaoProtocoloAction} botao="Devolver" classeBotao="btn-secundario" confirmar="Devolver o protocolo? A justificativa será mostrada ao interessado." rotuloAcessivel="Devolver protocolo">
            {ocultos("DEVOLVER")}
            <Texto id="txt-devolver" rotulo="Justificativa da devolução" obrigatorio dica="Visível ao interessado na consulta pública." />
          </FormGed>
        </Painel>
      )}
      {tem("INDEFERIR") && (
        <Painel titulo="Indeferir">
          <FormGed action={acaoProtocoloAction} botao="Indeferir" classeBotao="btn-perigo" confirmar="Indeferir o protocolo? A justificativa será mostrada ao interessado." rotuloAcessivel="Indeferir protocolo">
            {ocultos("INDEFERIR")}
            <Texto id="txt-indeferir" rotulo="Justificativa do indeferimento" obrigatorio dica="Visível ao interessado na consulta pública." />
          </FormGed>
        </Painel>
      )}
      {tem("ARQUIVAR") && (
        <Painel titulo="Arquivar">
          <FormGed action={acaoProtocoloAction} botao="Arquivar protocolo" classeBotao="btn-secundario" confirmar="Arquivar o protocolo? Ele deixa de admitir novas movimentações." rotuloAcessivel="Arquivar protocolo">
            {ocultos("ARQUIVAR")}
            <Texto id="txt-arquivar" rotulo="Motivo do arquivamento" />
          </FormGed>
        </Painel>
      )}
      {semComprovante && (
        <Painel titulo="Comprovante">
          <FormGed action={emitirComprovanteAction} botao="Emitir comprovante" rotuloAcessivel="Emitir comprovante">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm text-slate-600">O comprovante ainda não foi emitido para este protocolo.</p>
          </FormGed>
        </Painel>
      )}
      {acoes.length === 0 && !semComprovante && <p className="text-sm text-slate-600">Protocolo arquivado: não admite novas movimentações.</p>}
    </div>
  );
}
