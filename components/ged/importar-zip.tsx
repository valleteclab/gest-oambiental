"use client";
// Envio do ZIP para importação em lote: arrastar e soltar OU escolher; envia por XHR (barra de progresso) para /api/v1/ged/importacoes.
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ROTULO_SENSIBILIDADE_GED, SENSIBILIDADES_GED, type GedSensibilidade } from "@/lib/ged/tipos";

type PastaOpcao = { id: string; caminho_nome: string; sensibilidade_padrao: GedSensibilidade };
const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const LIMITE_MB = 300;

export function ImportarZip({ tipos, pastas }: { tipos: { id: string; nome: string }[]; pastas: PastaOpcao[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [arq, setArq] = useState<File | null>(null);
  const [sobre, setSobre] = useState(false);
  const [erro, setErro] = useState("");
  const [progresso, setProgresso] = useState<number | null>(null);
  const [pasta, setPasta] = useState("");
  const [sens, setSens] = useState<GedSensibilidade>("RESTRITO");

  const escolher = (f: File | undefined) => {
    setErro("");
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return setErro("Envie um arquivo ZIP (.zip).");
    if (f.size > LIMITE_MB * 1048576) return setErro(`O ZIP excede o limite de ${LIMITE_MB} MB. Divida em lotes menores.`);
    setArq(f);
  };

  const enviar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!arq) return setErro("Escolha o arquivo ZIP.");
    const fd = new FormData(e.currentTarget);
    fd.set("arquivo", arq);
    setErro("");
    setProgresso(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/ged/importacoes");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgresso(Math.round((ev.loaded / ev.total) * 100));
    xhr.onerror = () => { setProgresso(null); setErro("Falha de rede ao enviar o ZIP."); };
    xhr.onload = () => {
      let corpo: { id?: string; message?: string } = {};
      try { corpo = JSON.parse(xhr.responseText); } catch { /* resposta não-JSON */ }
      if (xhr.status === 201 && corpo.id) return router.push(`/ged/importar/${corpo.id}`);
      setProgresso(null);
      setErro(corpo.message ?? "Não foi possível iniciar a importação.");
    };
    xhr.send(fd);
  };

  return (
    <form aria-label="Importar ZIP" onSubmit={enviar} className="space-y-4">
      <div>
        <label
          htmlFor="arquivo-zip"
          onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
          onDragLeave={() => setSobre(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSobre(false);
            const f = e.dataTransfer.files?.[0];
            if (f && input.current) {
              const dt = new DataTransfer();
              dt.items.add(f);
              input.current.files = dt.files;
              escolher(f);
            }
          }}
          className={clsx("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm focus-within:outline-2 focus-within:outline-primaria-600", sobre ? "border-primaria-600 bg-primaria-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100")}
        >
          <span className="font-medium text-slate-800">{arq ? arq.name : "Arraste o ZIP para cá ou clique para escolher"}</span>
          <span className="text-xs text-slate-500">{arq ? tamanho(arq.size) : `Somente ZIP, até ${LIMITE_MB} MB`}</span>
          <input ref={input} id="arquivo-zip" type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(e) => escolher(e.target.files?.[0])} className="sr-only" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pasta_id">Pasta de destino</label>
          <select id="pasta_id" name="pasta_id" className="input" value={pasta} onChange={(e) => { setPasta(e.target.value); const p = pastas.find((x) => x.id === e.target.value); if (p) setSens(p.sensibilidade_padrao); }}>
            <option value="">Raiz (as pastas do ZIP ficam no topo)</option>
            {pastas.map((p) => <option key={p.id} value={p.id}>{p.caminho_nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tipo_id">Tipo de documento (todos)</label>
          <select id="tipo_id" name="tipo_id" className="input" defaultValue="">
            <option value="">Sem tipo</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sensibilidade">Sensibilidade (todos)</label>
          <select id="sensibilidade" name="sensibilidade" className="input" value={sens} onChange={(e) => setSens(e.target.value as GedSensibilidade)}>
            {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">Quem enxerga cada documento é definido pelas permissões da pasta onde ele cair.</p>
        </div>
      </div>
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      {progresso !== null && (
        <div role="status" aria-live="polite" className="text-sm text-slate-700">
          <div className="h-2 w-full overflow-hidden rounded bg-slate-200"><div className="h-full bg-primaria-600" style={{ width: `${progresso}%` }} /></div>
          <p className="mt-1">{progresso < 100 ? `Enviando… ${progresso}%` : "Validando o ZIP…"}</p>
        </div>
      )}
      <button className="btn-primario" disabled={progresso !== null}>{progresso !== null ? "Aguarde…" : "Importar ZIP"}</button>
    </form>
  );
}
