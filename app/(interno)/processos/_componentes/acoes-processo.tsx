"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { executarAcaoProcesso, type EstadoAcao } from "@/lib/processo/actions";
import { ROTULO_ACAO, type AcaoProcesso } from "@/lib/processo/maquina";

type Tecnico = { id: string; nome: string };

function Resultado({ estado }: { estado: EstadoAcao }) {
  if (!estado) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {estado.erro && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{estado.erro}</p>}
      {estado.ok && estado.mensagem && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{estado.mensagem}</p>}
      {estado.avisos?.map((a) => (
        <p key={a} role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{a}</p>
      ))}
    </div>
  );
}

/** Formulário genérico: monta o payload JSON e chama a Server Action da máquina de estados. */
export function FormAcao({ processoId, acao, payload, children, rotuloBotao, perigo, onConcluido, desabilitado }: { processoId: string; acao: AcaoProcesso; payload: Record<string, unknown>; children?: React.ReactNode; rotuloBotao?: string; perigo?: boolean; onConcluido?: () => void; desabilitado?: boolean }) {
  const [estado, enviar, pendente] = useActionState(executarAcaoProcesso.bind(null, processoId, acao), undefined);
  const router = useRouter();
  useEffect(() => {
    if (estado?.ok) {
      router.refresh();
      onConcluido?.();
    }
  }, [estado, router, onConcluido]);
  return (
    <form action={enviar} className="space-y-3" data-testid={`form-${acao}`}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {children}
      <Resultado estado={estado} />
      <button type="submit" className={perigo ? "btn-perigo" : "btn-primario"} disabled={pendente || desabilitado}>
        {pendente ? "Processando…" : (rotuloBotao ?? `Confirmar: ${ROTULO_ACAO[acao]}`)}
      </button>
    </form>
  );
}

function CampoTexto({ id, label, valor, set, obrigatorio, linhas = 3, dica }: { id: string; label: string; valor: string; set: (v: string) => void; obrigatorio?: boolean; linhas?: number; dica?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}{obrigatorio && <span className="text-red-700"> *</span>}</label>
      <textarea id={id} className="input" rows={linhas} value={valor} onChange={(e) => set(e.target.value)} required={obrigatorio} />
      {dica && <p className="mt-1 text-xs text-slate-500">{dica}</p>}
    </div>
  );
}

function PainelAcao({ processoId, acao, tecnicos, fechar, parecerDesfavoravel }: { processoId: string; acao: AcaoProcesso; tecnicos: Tecnico[]; fechar: () => void; parecerDesfavoravel?: boolean }) {
  const [despacho, setDespacho] = useState("");
  const [tecnico, setTecnico] = useState("");
  const [itens, setItens] = useState<string[]>([""]);
  const [prazo, setPrazo] = useState("");
  const [data, setData] = useState("");
  const [texto, setTexto] = useState("");
  const id = (s: string) => `${acao}-${s}`;

  switch (acao) {
    case "distribuir":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ tecnico_id: tecnico || null, despacho }} onConcluido={fechar}>
          <div>
            <label htmlFor={id("tecnico")} className="label">Técnico responsável</label>
            <select id={id("tecnico")} className="input" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
              <option value="">Automático (rodízio entre técnicos do município)</option>
              {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <CampoTexto id={id("despacho")} label="Despacho (opcional)" valor={despacho} set={setDespacho} linhas={2} />
        </FormAcao>
      );
    case "pendencia":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ itens: itens.filter((i) => i.trim()).map((descricao) => ({ descricao })), prazo_dias: prazo ? Number(prazo) : null, despacho }} onConcluido={fechar}>
          <fieldset className="space-y-2">
            <legend className="label">Pendências a comunicar ao requerente *</legend>
            {itens.map((v, n) => (
              <div key={n} className="flex gap-2">
                <label htmlFor={id(`item-${n}`)} className="sr-only">Pendência {n + 1}</label>
                <textarea id={id(`item-${n}`)} className="input" rows={2} value={v} placeholder={`Pendência ${n + 1}`} onChange={(e) => setItens(itens.map((x, i) => (i === n ? e.target.value : x)))} />
                {itens.length > 1 && <button type="button" className="btn-secundario btn-sm self-start" onClick={() => setItens(itens.filter((_, i) => i !== n))} aria-label={`Remover pendência ${n + 1}`}>Remover</button>}
              </div>
            ))}
            <button type="button" className="btn-secundario btn-sm" onClick={() => setItens([...itens, ""])}>+ Adicionar pendência</button>
          </fieldset>
          <div className="max-w-xs">
            <label htmlFor={id("prazo")} className="label">Prazo para resposta (dias)</label>
            <input id={id("prazo")} type="number" min={1} max={365} className="input" value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="Padrão do município (30)" />
          </div>
          <p className="text-xs text-slate-600">O relógio do processo fica pausado até a resposta do requerente.</p>
        </FormAcao>
      );
    case "responder":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ resposta: texto }} onConcluido={fechar}>
          <CampoTexto id={id("resposta")} label="Resposta do requerente (registro em balcão)" valor={texto} set={setTexto} obrigatorio />
        </FormAcao>
      );
    case "agendar_vistoria":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ data_prevista: data || null, despacho }} onConcluido={fechar}>
          <div className="max-w-xs">
            <label htmlFor={id("data")} className="label">Data prevista</label>
            <input id={id("data")} type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <CampoTexto id={id("despacho")} label="Observações (opcional)" valor={despacho} set={setDespacho} linhas={2} />
        </FormAcao>
      );
    case "concluir_vistoria":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ despacho }} onConcluido={fechar}>
          <CampoTexto id={id("despacho")} label="Relato / conclusão da vistoria" valor={despacho} set={setDespacho} dica="Obrigatório (mín. 10 caracteres) se a vistoria não foi registrada no módulo de fiscalização." />
        </FormAcao>
      );
    case "deferir":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ despacho }} onConcluido={fechar}>
          {parecerDesfavoravel && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Atenção: o parecer técnico é desfavorável.</p>}
          <CampoTexto id={id("despacho")} label="Despacho de deferimento (opcional)" valor={despacho} set={setDespacho} linhas={2} />
          <p className="text-xs text-slate-600">Ao confirmar, o documento (licença/autorização/certidão) é emitido com as condicionantes do parecer.</p>
        </FormAcao>
      );
    case "indeferir":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ motivo: texto }} perigo onConcluido={fechar}>
          <CampoTexto id={id("motivo")} label="Motivação do indeferimento" valor={texto} set={setTexto} obrigatorio dica="Constará do ofício de indeferimento enviado ao requerente." />
        </FormAcao>
      );
    case "arquivar":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ justificativa: texto }} perigo onConcluido={fechar}>
          <CampoTexto id={id("justificativa")} label="Justificativa do arquivamento" valor={texto} set={setTexto} obrigatorio />
        </FormAcao>
      );
    case "emitir_documento":
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{}} onConcluido={fechar}>
          <p className="text-sm text-slate-700">Gera o documento oficial da decisão (PDF com QR Code e código verificador) e conclui o processo.</p>
        </FormAcao>
      );
    default: // protocolar, aceitar
      return (
        <FormAcao processoId={processoId} acao={acao} payload={{ despacho }} onConcluido={fechar}>
          <CampoTexto id={id("despacho")} label="Despacho (opcional)" valor={despacho} set={setDespacho} linhas={2} />
        </FormAcao>
      );
  }
}

/** Barra de ações conforme estado + perfil (lista vem do servidor via acoesDisponiveis). */
export function AcoesProcesso({ processoId, acoes, tecnicos, parecerDesfavoravel }: { processoId: string; acoes: AcaoProcesso[]; tecnicos: Tecnico[]; parecerDesfavoravel?: boolean }) {
  const [aberta, setAberta] = useState<AcaoProcesso | null>(null);
  if (!acoes.length) return null;
  return (
    <div className="space-y-3" data-testid="acoes-processo">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Ações do processo">
        {acoes.map((a) =>
          a === "parecer" ? (
            <Link key={a} href={`/processos/${processoId}?aba=parecer`} className="btn-primario btn-sm">{ROTULO_ACAO[a]}</Link>
          ) : (
            <button
              key={a}
              type="button"
              className={aberta === a ? "btn-primario btn-sm" : a === "arquivar" || a === "indeferir" ? "btn-secundario btn-sm text-red-800" : "btn-secundario btn-sm"}
              aria-expanded={aberta === a}
              aria-controls="painel-acao"
              onClick={() => setAberta(aberta === a ? null : a)}
            >
              {ROTULO_ACAO[a]}
            </button>
          ),
        )}
      </div>
      {aberta && (
        <div id="painel-acao" className="card p-4">
          <h3 className="mb-3 font-semibold">{ROTULO_ACAO[aberta]}</h3>
          <PainelAcao key={aberta} processoId={processoId} acao={aberta} tecnicos={tecnicos} fechar={() => setAberta(null)} parecerDesfavoravel={parecerDesfavoravel} />
        </div>
      )}
    </div>
  );
}

type Condicionante = { descricao: string; periodicidade: string; prazo_dias: string };

/** Formulário do parecer técnico (aba Parecer). */
export function FormParecer({ processoId, checklistPendente }: { processoId: string; checklistPendente: string[] }) {
  const [conclusao, setConclusao] = useState<"FAVORAVEL" | "DESFAVORAVEL" | "FAVORAVEL_COM_CONDICIONANTES">("FAVORAVEL_COM_CONDICIONANTES");
  const [texto, setTexto] = useState("");
  const [conds, setConds] = useState<Condicionante[]>([{ descricao: "", periodicidade: "", prazo_dias: "" }]);
  const payload = {
    conclusao,
    texto,
    condicionantes: conclusao === "FAVORAVEL_COM_CONDICIONANTES" ? conds.filter((c) => c.descricao.trim()).map((c) => ({ descricao: c.descricao, periodicidade: c.periodicidade || null, prazo_dias: c.prazo_dias ? Number(c.prazo_dias) : null })) : [],
  };
  const upd = (n: number, campo: keyof Condicionante, v: string) => setConds(conds.map((c, i) => (i === n ? { ...c, [campo]: v } : c)));
  return (
    <FormAcao processoId={processoId} acao="parecer" payload={payload} rotuloBotao="Emitir parecer técnico">
      {checklistPendente.length > 0 && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Checklist incompleto – itens obrigatórios pendentes: {checklistPendente.join("; ")}. <Link className="underline" href={`/processos/${processoId}?aba=checklist`}>Preencher checklist</Link>
        </p>
      )}
      <fieldset>
        <legend className="label">Conclusão *</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {([
            ["FAVORAVEL", "Favorável"],
            ["FAVORAVEL_COM_CONDICIONANTES", "Favorável com condicionantes"],
            ["DESFAVORAVEL", "Desfavorável"],
          ] as const).map(([v, r]) => (
            <label key={v} className="inline-flex items-center gap-2">
              <input type="radio" name="conclusao" value={v} checked={conclusao === v} onChange={() => setConclusao(v)} /> {r}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="parecer-texto" className="label">Texto do parecer *</label>
        <textarea id="parecer-texto" className="input" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} required minLength={20} placeholder="Histórico, análise técnica, fundamentação legal e conclusão…" />
      </div>
      {conclusao === "FAVORAVEL_COM_CONDICIONANTES" && (
        <fieldset className="space-y-3">
          <legend className="label">Condicionantes *</legend>
          {conds.map((c, n) => (
            <div key={n} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_10rem_8rem_auto]">
              <div>
                <label htmlFor={`cond-${n}-d`} className="text-xs font-medium text-slate-700">Descrição</label>
                <textarea id={`cond-${n}-d`} className="input" rows={2} value={c.descricao} onChange={(e) => upd(n, "descricao", e.target.value)} />
              </div>
              <div>
                <label htmlFor={`cond-${n}-p`} className="text-xs font-medium text-slate-700">Periodicidade</label>
                <input id={`cond-${n}-p`} className="input" value={c.periodicidade} onChange={(e) => upd(n, "periodicidade", e.target.value)} placeholder="Ex.: semestral" />
              </div>
              <div>
                <label htmlFor={`cond-${n}-z`} className="text-xs font-medium text-slate-700">Prazo (dias)</label>
                <input id={`cond-${n}-z`} type="number" min={1} className="input" value={c.prazo_dias} onChange={(e) => upd(n, "prazo_dias", e.target.value)} />
              </div>
              <div className="self-end">
                {conds.length > 1 && <button type="button" className="btn-secundario btn-sm" onClick={() => setConds(conds.filter((_, i) => i !== n))} aria-label={`Remover condicionante ${n + 1}`}>Remover</button>}
              </div>
            </div>
          ))}
          <button type="button" className="btn-secundario btn-sm" onClick={() => setConds([...conds, { descricao: "", periodicidade: "", prazo_dias: "" }])}>+ Adicionar condicionante</button>
        </fieldset>
      )}
    </FormAcao>
  );
}
