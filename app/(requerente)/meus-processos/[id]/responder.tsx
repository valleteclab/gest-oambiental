"use client";
import { useState } from "react";
import { FormAcao } from "../../../(interno)/processos/_componentes/acoes-processo";
import { UploadAnexo } from "../../../(interno)/processos/_componentes/formularios";

type Pend = { id: string; descricao: string; prazo: string; anexos: { id: string; nome: string }[] };

/** Resposta às pendências: texto por pendência + arquivos (enviados pela API de anexos). */
export function ResponderPendencias({ processoId, pendencias }: { processoId: string; pendencias: Pend[] }) {
  const [textos, setTextos] = useState<Record<string, string>>({});
  const payload = { respostas: pendencias.map((p) => ({ pendencia_id: p.id, resposta: textos[p.id] ?? "" })) };
  const completo = pendencias.every((p) => (textos[p.id] ?? "").trim().length > 0);
  return (
    <FormAcao processoId={processoId} acao="responder" payload={payload} rotuloBotao="Enviar resposta ao órgão ambiental" desabilitado={!completo}>
      {pendencias.map((p, n) => (
        <div key={p.id} className="rounded-md border border-amber-300 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">Pendência {n + 1} <span className="font-normal text-slate-600">· responder até {p.prazo}</span></p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{p.descricao}</p>
          <label htmlFor={`resp-${p.id}`} className="label mt-3">Sua resposta *</label>
          <textarea id={`resp-${p.id}`} className="input" rows={3} value={textos[p.id] ?? ""} onChange={(e) => setTextos({ ...textos, [p.id]: e.target.value })} required />
          <div className="mt-2 space-y-1">
            {p.anexos.map((a) => <p key={a.id} className="text-xs text-slate-700">Arquivo enviado: <a className="text-primaria-700 underline" href={`/api/v1/anexos/${a.id}`}>{a.nome}</a></p>)}
            <UploadAnexo processoId={processoId} meta={{ tipo: "RESPOSTA_PENDENCIA", pendencia_id: p.id }} rotulo="Anexar arquivo(s)" multiplo />
          </div>
        </div>
      ))}
    </FormAcao>
  );
}
