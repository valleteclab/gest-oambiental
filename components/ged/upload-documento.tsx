"use client";
// Formulário de envio de PDF: arrastar e soltar OU escolher o arquivo; o título é sugerido pelo nome do arquivo.
import clsx from "clsx";
import Link from "next/link";
import { useRef, useState } from "react";
import { FormGed } from "@/components/ged/form-ged";
import { SeletorMarcadores, type MarcadorChip } from "@/components/ged/seletor-marcadores";
import { criarDocumentoAction } from "@/app/(ged)/ged/documentos/actions";
import { ROTULO_SENSIBILIDADE_GED, SENSIBILIDADES_GED, type GedSensibilidade } from "@/lib/ged/tipos";

type PastaOpcao = { id: string; caminho_nome: string; sensibilidade_padrao: GedSensibilidade };

const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Zona de arquivo (drag & drop + input). Reutilizável (também na "nova versão"). */
export function ZonaArquivoPdf({ id = "arquivo", aoEscolher }: { id?: string; aoEscolher?: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [arq, setArq] = useState<File | null>(null);
  const [sobre, setSobre] = useState(false);
  const [erro, setErro] = useState("");
  const escolher = (f: File | undefined) => {
    setErro("");
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { setErro("Envie um arquivo PDF (.pdf)."); return; }
    if (f.size > 25 * 1024 * 1024) { setErro("O arquivo excede o limite de 25 MB."); return; }
    setArq(f);
    aoEscolher?.(f);
  };
  return (
    <div>
      <label
        htmlFor={id}
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
        <span className="font-medium text-slate-800">{arq ? arq.name : "Arraste o PDF para cá ou clique para escolher"}</span>
        <span className="text-xs text-slate-500">{arq ? tamanho(arq.size) : "Somente PDF, até 25 MB"}</span>
        <input ref={input} id={id} name="arquivo" type="file" accept="application/pdf,.pdf" required onChange={(e) => escolher(e.target.files?.[0])} className="sr-only" />
      </label>
      {erro && <p role="alert" className="mt-1 text-sm text-red-700">{erro}</p>}
    </div>
  );
}

export function UploadDocumento({ tipos, pastas, marcadores, pastaInicial }: {
  tipos: { id: string; nome: string }[];
  pastas: PastaOpcao[];
  marcadores: MarcadorChip[];
  pastaInicial?: string | null;
}) {
  const [pasta, setPasta] = useState(pastas.some((p) => p.id === pastaInicial) ? (pastaInicial as string) : "");
  const [sens, setSens] = useState<GedSensibilidade>(pastas.find((p) => p.id === pastaInicial)?.sensibilidade_padrao ?? "RESTRITO");
  const [titulo, setTitulo] = useState("");
  const [tituloEditado, setTituloEditado] = useState(false);
  return (
    <FormGed action={criarDocumentoAction} botao="Enviar documento" rotuloAcessivel="Enviar documento em PDF">
      <ZonaArquivoPdf
        aoEscolher={(f) => {
          if (!tituloEditado) setTitulo(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim());
        }}
      />
      <div>
        <label className="label" htmlFor="titulo">Título</label>
        <input id="titulo" name="titulo" className="input" required minLength={3} maxLength={250} value={titulo} onChange={(e) => { setTitulo(e.target.value); setTituloEditado(true); }} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="tipo_id">Tipo de documento</label>
          <select id="tipo_id" name="tipo_id" className="input" defaultValue="">
            <option value="">Sem tipo</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="remetente">Remetente / origem</label>
          <input id="remetente" name="remetente" className="input" maxLength={200} />
        </div>
        <div>
          <label className="label" htmlFor="data_documento">Data do documento</label>
          <input id="data_documento" name="data_documento" type="date" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="pasta_id">Pasta</label>
          <select
            id="pasta_id"
            name="pasta_id"
            className="input"
            value={pasta}
            onChange={(e) => {
              setPasta(e.target.value);
              const p = pastas.find((x) => x.id === e.target.value);
              if (p) setSens(p.sensibilidade_padrao);
            }}
          >
            <option value="">Sem pasta (só você e administradores)</option>
            {pastas.map((p) => <option key={p.id} value={p.id}>{p.caminho_nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sensibilidade">Sensibilidade</label>
          <select id="sensibilidade" name="sensibilidade" className="input" value={sens} onChange={(e) => setSens(e.target.value as GedSensibilidade)}>
            {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">A pasta escolhida sugere a sensibilidade padrão. Sigiloso só é visível a quem receber permissão explícita.</p>
        </div>
      </div>
      <SeletorMarcadores marcadores={marcadores} />
      <p className="text-sm text-slate-600">
        Prefere escrever o documento aqui? <Link href={`/ged/editor/novo${pasta ? `?pasta=${pasta}` : ""}`} className="font-medium text-primaria-700 underline">Criar no editor de texto</Link>.
      </p>
    </FormGed>
  );
}
