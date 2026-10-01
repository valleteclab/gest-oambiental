"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { gerarPdfParecerAcao, gerarReciboAcao, salvarChecklistAcao } from "@/lib/processo/actions";
import type { ItemChecklist } from "@/lib/processo/maquina";
import { ACCEPT_PADRAO, enviarAnexo, type MetaUpload } from "@/lib/processo/upload-cliente";

/** Checklist de análise (SIM_NAO / TEXTO / NUMERO; TEXTO com `opcoes` = escolha única). */
export function FormChecklist({ processoId, itens, respostas, editavel }: { processoId: string; itens: ItemChecklist[]; respostas: Record<string, unknown>; editavel: boolean }) {
  const [estado, enviar, pendente] = useActionState(salvarChecklistAcao.bind(null, processoId), undefined);
  return (
    <form action={enviar} className="space-y-4" data-testid="form-checklist">
      <CamposChecklist itens={itens} respostas={respostas} editavel={editavel} />
      {estado?.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
      {estado?.ok && <p role="status" className="text-sm text-emerald-700">{estado.mensagem}</p>}
      {editavel && <button className="btn-primario" disabled={pendente}>{pendente ? "Salvando…" : "Salvar checklist"}</button>}
    </form>
  );
}

/** Campos do checklist (name="item:<id>") – reutilizados no formulário de vistoria das demandas urbanas (/demandas). */
export function CamposChecklist({ itens, respostas, editavel }: { itens: ItemChecklist[]; respostas: Record<string, unknown>; editavel: boolean }) {
  return (
    <fieldset disabled={!editavel} className="space-y-4">
      {itens.map((i) => {
        const id = `item-${i.id}`;
        const v = respostas[i.id];
        const valor = v === null || v === undefined ? "" : String(v);
        return (
          <div key={i.id} className="rounded-md border border-slate-200 p-3">
            {i.tipo === "SIM_NAO" ? (
              <fieldset>
                <legend className="text-sm font-medium text-slate-800">{i.texto}{i.obrigatorio && <span className="text-red-700"> *</span>}</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  {([["SIM", "Sim"], ["NAO", "Não"], ["NA", "Não se aplica"]] as const).map(([k, r]) => (
                    <label key={k} className="inline-flex min-h-8 items-center gap-2">
                      <input type="radio" name={`item:${i.id}`} value={k} defaultChecked={valor === k} /> {r}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : i.opcoes?.length ? (
              <fieldset>
                <legend className="text-sm font-medium text-slate-800">{i.texto}{i.obrigatorio && <span className="text-red-700"> *</span>}</legend>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  {i.opcoes.map((o) => (
                    <label key={o} className="inline-flex min-h-8 items-center gap-2">
                      <input type="radio" name={`item:${i.id}`} value={o} defaultChecked={valor === o} /> {o}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <>
                <label htmlFor={id} className="text-sm font-medium text-slate-800">{i.texto}{i.obrigatorio && <span className="text-red-700"> *</span>}</label>
                {i.tipo === "NUMERO" ? (
                  <input id={id} name={`item:${i.id}`} type="text" inputMode="decimal" className="input mt-1 max-w-xs" defaultValue={valor} />
                ) : (
                  <textarea id={id} name={`item:${i.id}`} className="input mt-1" rows={2} defaultValue={valor} />
                )}
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Upload de arquivos (usa a API de anexos; local = multipart, S3 = URL pré-assinada). */
export function UploadAnexo({ processoId, meta, rotulo = "Anexar arquivo", accept = ACCEPT_PADRAO, multiplo = false, onEnviado }: { processoId: string; meta?: MetaUpload; rotulo?: string; accept?: string; multiplo?: boolean; onEnviado?: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ erro?: string; ok?: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const id = `upload-${meta?.documento_exigido_id ?? meta?.pendencia_id ?? "geral"}`;
  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? []);
    if (!arquivos.length) return;
    setEnviando(true);
    setStatus(null);
    try {
      for (const f of arquivos) await enviarAnexo(processoId, f, meta);
      setStatus({ ok: `${arquivos.length} arquivo(s) enviado(s).` });
      onEnviado?.();
      router.refresh();
    } catch (err) {
      setStatus({ erro: err instanceof Error ? err.message : "Falha no envio." });
    } finally {
      setEnviando(false);
      if (ref.current) ref.current.value = "";
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className={`btn-secundario btn-sm cursor-pointer ${enviando ? "pointer-events-none opacity-50" : ""}`}>{enviando ? "Enviando…" : rotulo}</label>
      <input ref={ref} id={id} type="file" className="sr-only" accept={accept} multiple={multiplo} onChange={aoEscolher} disabled={enviando} />
      {status?.erro && <span role="alert" className="text-xs text-red-700">{status.erro}</span>}
      {status?.ok && <span role="status" className="text-xs text-emerald-700">{status.ok}</span>}
    </div>
  );
}

/** Botão de nova tentativa de emissão (recibo / PDF do parecer). */
export function BotaoReemitir({ processoId, parecerId, rotulo }: { processoId: string; parecerId?: string; rotulo: string }) {
  const [pendente, iniciar] = useTransition();
  const [msg, setMsg] = useState<{ erro?: string; ok?: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secundario btn-sm"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const r = parecerId ? await gerarPdfParecerAcao(processoId, parecerId) : await gerarReciboAcao(processoId);
            setMsg(r?.erro ? { erro: r.erro } : { ok: r?.mensagem });
            router.refresh();
          })
        }
      >
        {pendente ? "Gerando…" : rotulo}
      </button>
      {msg?.erro && <span role="alert" className="text-xs text-red-700">{msg.erro}</span>}
      {msg?.ok && <span role="status" className="text-xs text-emerald-700">{msg.ok}</span>}
    </span>
  );
}
