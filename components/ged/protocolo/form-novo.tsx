"use client";
// Registro de protocolo por servidor: entrada (balcão), saída ou interno. Os campos mudam com o livro escolhido.
import { useState } from "react";
import { FormGed } from "@/components/ged/form-ged";
import { registrarProtocoloAction } from "@/app/(ged)/ged/protocolo/actions";
import { PRIORIDADES, ROTULO_LIVRO, ROTULO_PRIORIDADE } from "@/lib/ged/protocolo/rotulos";
import type { GedLivroProtocolo } from "@prisma/client";

type Opcoes = { setores: { id: string; nome: string; sigla: string }[]; usuarios: { id: string; nome: string; cargo: string | null }[]; tipos: { id: string; nome: string }[] };

const DESCRICAO: Record<GedLivroProtocolo, string> = {
  ENTRADA: "Documento recebido de pessoa ou órgão externo (atendimento no balcão). O comprovante é entregue ao interessado.",
  SAIDA: "Documento enviado a pessoa ou órgão externo.",
  INTERNO: "Documento que circula entre setores ou pessoas do próprio órgão.",
};

function Interessado({ rotulo }: { rotulo: string }) {
  return (
    <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium text-slate-700">{rotulo}</legend>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="i_nome">Nome *</label>
        <input id="i_nome" name="i_nome" className="input" required minLength={3} maxLength={200} autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="i_cpf_cnpj">CPF ou CNPJ</label>
        <input id="i_cpf_cnpj" name="i_cpf_cnpj" className="input" inputMode="numeric" maxLength={20} autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="i_email">E-mail</label>
        <input id="i_email" name="i_email" type="email" className="input" maxLength={200} autoComplete="off" />
        <p className="mt-1 text-xs text-slate-500">Com e-mail, o interessado recebe a confirmação e os avisos de andamento.</p>
      </div>
      <div>
        <label className="label" htmlFor="i_telefone">Telefone</label>
        <input id="i_telefone" name="i_telefone" className="input" inputMode="tel" maxLength={30} autoComplete="off" />
      </div>
    </fieldset>
  );
}

function SeletorDestino({ opcoes, obrigatorio }: { opcoes: Opcoes; obrigatorio: boolean }) {
  return (
    <div>
      <label className="label" htmlFor="destino">Destino{obrigatorio ? " *" : ""}</label>
      <select id="destino" name="destino" className="input" required={obrigatorio} defaultValue="">
        <option value="" disabled={obrigatorio}>{obrigatorio ? "Selecione…" : "Sem destino"}</option>
        {opcoes.setores.length > 0 && <optgroup label="Setores">{opcoes.setores.map((s) => <option key={s.id} value={`SETOR:${s.id}`}>{s.nome} ({s.sigla})</option>)}</optgroup>}
        {opcoes.usuarios.length > 0 && <optgroup label="Pessoas">{opcoes.usuarios.map((u) => <option key={u.id} value={`USUARIO:${u.id}`}>{u.nome}{u.cargo ? ` – ${u.cargo}` : ""}</option>)}</optgroup>}
      </select>
      <p className="mt-1 text-xs text-slate-500">Os arquivos anexados são encaminhados ao destino pelo trâmite do documento.</p>
    </div>
  );
}

export function FormNovoProtocolo({ opcoes, livroInicial }: { opcoes: Opcoes; livroInicial: GedLivroProtocolo }) {
  const [livro, setLivro] = useState<GedLivroProtocolo>(livroInicial);
  return (
    <FormGed action={registrarProtocoloAction} botao="Registrar protocolo" rotuloAcessivel="Registrar protocolo">
      <fieldset>
        <legend className="label">Livro *</legend>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Livro do protocolo">
          {(["ENTRADA", "SAIDA", "INTERNO"] as const).map((l) => (
            <label key={l} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${livro === l ? "border-primaria-600 bg-primaria-50 font-medium" : "border-slate-300 bg-white"}`}>
              <input type="radio" name="livro" value={l} checked={livro === l} onChange={() => setLivro(l)} className="accent-emerald-700" />
              {ROTULO_LIVRO[l]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-600">{DESCRICAO[livro]}</p>
      </fieldset>

      {livro === "ENTRADA" && <Interessado rotulo="Remetente (quem entrega o documento)" />}
      {livro !== "ENTRADA" && (
        <div>
          <label className="label" htmlFor="origem_setor_id">Setor de origem *</label>
          <select id="origem_setor_id" name="origem_setor_id" className="input" required defaultValue="">
            <option value="" disabled>Selecione…</option>
            {opcoes.setores.map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.sigla})</option>)}
          </select>
        </div>
      )}
      {livro === "SAIDA" && <Interessado rotulo="Destinatário externo" />}

      <div>
        <label className="label" htmlFor="assunto">Assunto *</label>
        <input id="assunto" name="assunto" className="input" required minLength={3} maxLength={200} />
      </div>
      <div>
        <label className="label" htmlFor="descricao">Descrição</label>
        <textarea id="descricao" name="descricao" className="input min-h-24" rows={4} maxLength={5000} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="tipo_documento_id">Tipo de documento</label>
          <select id="tipo_documento_id" name="tipo_documento_id" className="input" defaultValue="">
            <option value="">Sem tipo</option>
            {opcoes.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="prioridade">Prioridade</label>
          <select id="prioridade" name="prioridade" className="input" defaultValue="NORMAL">
            {PRIORIDADES.map((p) => <option key={p} value={p}>{ROTULO_PRIORIDADE[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="prazo_resposta">Prazo de resposta (opcional)</label>
          <input id="prazo_resposta" name="prazo_resposta" type="date" className="input" />
        </div>
      </div>
      {livro !== "SAIDA" && <SeletorDestino opcoes={opcoes} obrigatorio />}
      <div>
        <label className="label" htmlFor="arquivos">Arquivos PDF (opcional)</label>
        <input id="arquivos" name="arquivos" type="file" accept="application/pdf,.pdf" multiple className="input" />
        <p className="mt-1 text-xs text-slate-500">Até 10 arquivos, 25 MB cada. Cada PDF vira um documento do módulo (restrito) vinculado ao protocolo.</p>
      </div>
    </FormGed>
  );
}
