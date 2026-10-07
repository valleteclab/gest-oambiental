// Lista de documentos (cartões – legível desde 320 px) com selos, marcadores, indicador de indexação e trechos da busca.
import Link from "next/link";
import { Badge } from "@/components/ui";
import { ChipMarcador } from "@/components/ged/seletor-marcadores";
import type { LinhaDocumento } from "@/lib/ged/documentos/listar";
import type { TrechoSnippet } from "@/lib/ged/documentos/snippet";
import { COR_STATUS_DOCUMENTO_GED, ROTULO_SENSIBILIDADE_GED, ROTULO_STATUS_DOCUMENTO_GED } from "@/lib/ged/tipos";
import { fmtDataCivil } from "@/lib/format";

const COR_SENS = { PUBLICO: "verde", RESTRITO: "amarelo", SIGILOSO: "vermelho" } as const;

/** Estado da indexação do texto da versão atual. */
export function IndicadorTexto({ status }: { status: LinhaDocumento["texto_status"] }) {
  if (status === "PENDENTE") return <Badge cor="azul">Indexando…</Badge>;
  if (status === "SEM_TEXTO") return <Badge cor="cinza">Sem texto (escaneado)</Badge>;
  if (status === "OCR_PENDENTE") return <Badge cor="azul">Aguardando OCR</Badge>;
  if (status === "ERRO") return <Badge cor="vermelho">Falha na indexação</Badge>;
  return null;
}

export function BadgeLgpd({ contem, status }: { contem: boolean; status: LinhaDocumento["anonimizacao_status"] }) {
  if (!contem) return null;
  if (status === "PENDENTE") return <Badge cor="vermelho">Contém dados pessoais – anonimização pendente</Badge>;
  if (status === "ANONIMIZADA") return <Badge cor="verde">Dados pessoais – anonimizado</Badge>;
  return <Badge cor="amarelo">Contém dados pessoais</Badge>;
}

function Trechos({ trechos }: { trechos: TrechoSnippet[] }) {
  return (
    <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="snippet">
      …{trechos.map((t, i) => (t.destaque ? <mark key={i} className="rounded bg-amber-200 px-0.5 text-slate-900">{t.texto}</mark> : <span key={i}>{t.texto}</span>))}…
    </p>
  );
}

export function ListaDocumentos({ linhas, comBusca }: { linhas: LinhaDocumento[]; comBusca: boolean }) {
  if (linhas.length === 0) {
    return <p className="card p-8 text-center text-sm text-slate-600">{comBusca ? "Nenhum documento encontrado para esta busca." : "Nenhum documento encontrado."}</p>;
  }
  return (
    <ul className="space-y-3" aria-label="Documentos">
      {linhas.map((d) => (
        <li key={d.id} className="card p-4" data-testid="documento-item">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/ged/documentos/${d.id}`} prefetch={false} className="break-words text-base font-semibold text-primaria-700 hover:underline">{d.titulo}</Link>
              <div className="mt-0.5 text-xs text-slate-500">{d.numero}{d.paginas ? ` · ${d.paginas} pág.` : ""}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge cor={COR_STATUS_DOCUMENTO_GED[d.status]}>{ROTULO_STATUS_DOCUMENTO_GED[d.status]}</Badge>
              <Badge cor={COR_SENS[d.sensibilidade]}>{ROTULO_SENSIBILIDADE_GED[d.sensibilidade]}</Badge>
              <BadgeLgpd contem={d.contem_dados_pessoais} status={d.anonimizacao_status} />
              <IndicadorTexto status={d.texto_status} />
            </div>
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
            {d.remetente && <div><dt className="inline text-slate-500">Remetente: </dt><dd className="inline">{d.remetente}</dd></div>}
            {d.data_documento && <div><dt className="inline text-slate-500">Data: </dt><dd className="inline">{fmtDataCivil(d.data_documento)}</dd></div>}
            {d.tipo && <div><dt className="inline text-slate-500">Tipo: </dt><dd className="inline">{d.tipo.nome}</dd></div>}
            {d.pasta && <div><dt className="inline text-slate-500">Pasta: </dt><dd className="inline break-words">{d.pasta.caminho_nome}</dd></div>}
          </dl>
          {d.marcadores.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{d.marcadores.map((m) => <ChipMarcador key={m.id} marcador={m} />)}</div>}
          {d.trechos && d.trechos.length > 0 && <Trechos trechos={d.trechos} />}
        </li>
      ))}
    </ul>
  );
}
