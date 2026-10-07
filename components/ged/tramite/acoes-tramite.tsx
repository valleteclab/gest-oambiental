"use client";
import { FormGed } from "@/components/ged/form-ged";
import { arquivarAction, cienciaAction, despacharAction, devolverAction, enviarAction } from "@/app/(ged)/ged/tramite/actions";

type Opcoes = { usuarios: { id: string; nome: string; cargo: string | null }[]; setores: { id: string; nome: string; sigla: string }[] };

const Despacho = ({ id, obrigatorio, rotulo = "Despacho" }: { id: string; obrigatorio?: boolean; rotulo?: string }) => (
  <div>
    <label className="label" htmlFor={id}>{rotulo}{obrigatorio ? " *" : " (opcional)"}</label>
    <textarea id={id} name="despacho" className="input min-h-20" rows={3} maxLength={4000} required={obrigatorio} />
  </div>
);

function Painel({ titulo, children, aberto }: { titulo: string; children: React.ReactNode; aberto?: boolean }) {
  return (
    <details className="rounded-md border border-slate-200 bg-white" open={aberto}>
      <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primaria-600">{titulo}</summary>
      <div className="border-t border-slate-100 p-3">{children}</div>
    </details>
  );
}

/** Formulários das ações de trâmite (o servidor decide quais mostrar conforme a permissão TRAMITAR). */
export function AcoesTramite({ documentoId, opcoes, souDestinatario, cienciaPendente, podeDevolver, arquivado }: {
  documentoId: string;
  opcoes: Opcoes;
  souDestinatario: boolean;
  cienciaPendente: boolean;
  podeDevolver: boolean;
  arquivado: boolean;
}) {
  if (arquivado) return <p className="text-sm text-slate-600">Documento arquivado: não admite novos trâmites.</p>;
  const oculto = <input type="hidden" name="documento_id" value={documentoId} />;
  return (
    <div className="space-y-2" data-testid="acoes-tramite">
      {souDestinatario && cienciaPendente && (
        <Painel titulo="Dar ciência" aberto>
          <FormGed action={cienciaAction} botao="Registrar ciência" rotuloAcessivel="Dar ciência">
            {oculto}
            <p className="text-sm text-slate-600">Confirma que você recebeu e tomou conhecimento do documento.</p>
            <Despacho id={`ciencia-${documentoId}`} rotulo="Observação" />
          </FormGed>
        </Painel>
      )}
      <Painel titulo="Enviar a um usuário ou setor">
        <FormGed action={enviarAction} botao="Enviar" limparAoSalvar rotuloAcessivel="Enviar documento">
          {oculto}
          <div>
            <label className="label" htmlFor={`destino-${documentoId}`}>Destinatário *</label>
            <select id={`destino-${documentoId}`} name="destino" className="input" required defaultValue="">
              <option value="" disabled>Selecione…</option>
              {opcoes.setores.length > 0 && (
                <optgroup label="Setores">
                  {opcoes.setores.map((s) => <option key={s.id} value={`SETOR:${s.id}`}>{s.nome} ({s.sigla})</option>)}
                </optgroup>
              )}
              {opcoes.usuarios.length > 0 && (
                <optgroup label="Usuários">
                  {opcoes.usuarios.map((u) => <option key={u.id} value={`USUARIO:${u.id}`}>{u.nome}{u.cargo ? ` – ${u.cargo}` : ""}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <Despacho id={`despacho-env-${documentoId}`} />
          <div>
            <label className="label" htmlFor={`prazo-${documentoId}`}>Prazo para ciência/resposta (opcional)</label>
            <input id={`prazo-${documentoId}`} name="prazo" type="datetime-local" className="input" />
          </div>
        </FormGed>
      </Painel>
      <Painel titulo="Registrar despacho (sem mover o documento)">
        <FormGed action={despacharAction} botao="Registrar despacho" limparAoSalvar rotuloAcessivel="Registrar despacho">
          {oculto}
          <Despacho id={`despacho-nota-${documentoId}`} obrigatorio />
        </FormGed>
      </Painel>
      {podeDevolver && (
        <Painel titulo="Devolver ao remetente anterior">
          <FormGed action={devolverAction} botao="Devolver" classeBotao="btn-secundario" confirmar="Devolver o documento ao remetente anterior?" rotuloAcessivel="Devolver documento">
            {oculto}
            <Despacho id={`despacho-dev-${documentoId}`} obrigatorio rotulo="Motivo da devolução" />
          </FormGed>
        </Painel>
      )}
      <Painel titulo="Arquivar">
        <FormGed action={arquivarAction} botao="Arquivar documento" classeBotao="btn-perigo" confirmar="Arquivar o documento? Ele sairá das caixas de entrada e não admitirá novos trâmites." rotuloAcessivel="Arquivar documento">
          {oculto}
          <Despacho id={`despacho-arq-${documentoId}`} rotulo="Motivo do arquivamento" />
        </FormGed>
      </Painel>
    </div>
  );
}
