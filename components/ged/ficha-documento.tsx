// Ficha (painel de metadados) e lista de versões do documento. Server Components.
import Link from "next/link";
import type { GedAnonimizacao } from "@prisma/client";
import type { GedStatusOcr } from "@prisma/client";
import { Badge } from "@/components/ui";
import { BadgeLgpd, IndicadorTexto } from "@/components/ged/lista-documentos";
import { ChipMarcador, type MarcadorChip } from "@/components/ged/seletor-marcadores";
import { COR_STATUS_DOCUMENTO_GED, ROTULO_ORIGEM_VERSAO_GED, ROTULO_SENSIBILIDADE_GED, ROTULO_STATUS_DOCUMENTO_GED, type GedOrigemVersao, type GedSensibilidade, type GedStatusDocumento } from "@/lib/ged/tipos";
import { apresentacaoOcr } from "@/lib/ged/ocr/decisao";
import { fmtDataCivil, fmtDataHora } from "@/lib/format";

export type FichaDados = {
  id: string;
  numero: string;
  titulo: string;
  status: GedStatusDocumento;
  sensibilidade: GedSensibilidade;
  remetente: string | null;
  data_documento: Date | null;
  tipo: { nome: string } | null;
  pasta: { id: string; caminho_nome: string } | null;
  criado_por_nome: string | null;
  created_at: Date;
  updated_at: Date;
  contem_dados_pessoais: boolean;
  anonimizacao_status: GedAnonimizacao;
  marcadores: MarcadorChip[];
  codigo_verificador: string | null;
  sha256_final: string | null;
};

export type VersaoView = {
  id: string;
  n: number;
  origem: GedOrigemVersao;
  nome_arquivo: string;
  tamanho: number;
  sha256: string;
  paginas: number | null;
  texto_status: "PENDENTE" | "EXTRAIDO" | "SEM_TEXTO" | "OCR_PENDENTE" | "ERRO";
  ocr_status?: GedStatusOcr | null;
  ocr_mensagem?: string | null;
  selada: boolean;
  created_at: Date;
};

/** Estado do OCR da versão (Pendente / Processando / Concluído / Indisponível / Cota excedida / Falhou). */
export function IndicadorOcr({ status, mensagem }: { status: GedStatusOcr | null | undefined; mensagem?: string | null }) {
  if (!status) return null;
  const a = apresentacaoOcr(status);
  return (
    <span data-testid="ocr-status" data-status={status} title={mensagem ?? a.descricao} className="inline-flex flex-col gap-0.5">
      <Badge cor={a.cor}>{a.rotulo}</Badge>
      {mensagem && status !== "CONCLUIDO" && <span className="text-xs text-slate-600">{mensagem}</span>}
    </span>
  );
}

const COR_SENS = { PUBLICO: "verde", RESTRITO: "amarelo", SIGILOSO: "vermelho" } as const;
const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function SelosDocumento({ d }: { d: Pick<FichaDados, "status" | "sensibilidade" | "contem_dados_pessoais" | "anonimizacao_status"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge cor={COR_STATUS_DOCUMENTO_GED[d.status]}>{ROTULO_STATUS_DOCUMENTO_GED[d.status]}</Badge>
      <Badge cor={COR_SENS[d.sensibilidade]}>{ROTULO_SENSIBILIDADE_GED[d.sensibilidade]}</Badge>
      <BadgeLgpd contem={d.contem_dados_pessoais} status={d.anonimizacao_status} />
    </span>
  );
}

export function FichaDocumento({ d }: { d: FichaDados }) {
  const linhas: [string, React.ReactNode][] = [
    ["Número", d.numero],
    ["Remetente / origem", d.remetente ?? "—"],
    ["Data do documento", fmtDataCivil(d.data_documento)],
    ["Tipo", d.tipo?.nome ?? "—"],
    ["Pasta", d.pasta ? <Link key="p" href={`/ged/pastas?pasta=${d.pasta.id}`} prefetch={false} className="text-primaria-700 hover:underline">{d.pasta.caminho_nome}</Link> : "Sem pasta"],
    ["Criado por", d.criado_por_nome ?? "—"],
    ["Criado em", fmtDataHora(d.created_at)],
    ["Atualizado em", fmtDataHora(d.updated_at)],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="ficha-documento">
      {linhas.map(([k, v]) => (
        <div key={k}><dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt><dd className="break-words">{v}</dd></div>
      ))}
      <div className="sm:col-span-2">
        <dt className="text-xs uppercase tracking-wide text-slate-500">Marcadores</dt>
        <dd className="mt-1 flex flex-wrap gap-1.5">{d.marcadores.length ? d.marcadores.map((m) => <ChipMarcador key={m.id} marcador={m} />) : <span className="text-slate-500">Nenhum</span>}</dd>
      </div>
      {d.codigo_verificador && (
        <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-slate-500">Código verificador</dt><dd className="font-mono text-xs break-all">{d.codigo_verificador}</dd></div>
      )}
    </dl>
  );
}

export function ListaVersoes({ documentoId, versoes, atualId }: { documentoId: string; versoes: VersaoView[]; atualId: string | null }) {
  if (versoes.length === 0) return <p className="text-sm text-slate-600">Este documento ainda não tem arquivo.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="tabela" data-testid="versoes">
        <caption className="sr-only">Versões do documento</caption>
        <thead>
          <tr><th scope="col">Versão</th><th scope="col">Origem</th><th scope="col">Arquivo</th><th scope="col">SHA-256</th><th scope="col">Em</th><th scope="col"><span className="sr-only">Baixar</span></th></tr>
        </thead>
        <tbody>
          {versoes.map((v) => (
            <tr key={v.id}>
              <td className="whitespace-nowrap font-medium">v{v.n}{v.id === atualId && <> <Badge cor="azul">Atual</Badge></>}{v.selada && <> <Badge cor="verde">Selada</Badge></>}</td>
              <td>{ROTULO_ORIGEM_VERSAO_GED[v.origem]}<div className="mt-1"><IndicadorTexto status={v.texto_status} /></div><div className="mt-1"><IndicadorOcr status={v.ocr_status} mensagem={v.ocr_mensagem} /></div></td>
              <td className="break-words">{v.nome_arquivo}<div className="text-xs text-slate-500">{tamanho(v.tamanho)}{v.paginas ? ` · ${v.paginas} pág.` : ""}</div></td>
              <td><code className="break-all text-xs" title={v.sha256}>{v.sha256.slice(0, 16)}…</code><details className="text-xs"><summary className="cursor-pointer text-primaria-700">completo</summary><code className="break-all">{v.sha256}</code></details></td>
              <td className="whitespace-nowrap text-xs">{fmtDataHora(v.created_at)}</td>
              <td><a className="btn-secundario btn-sm" href={`/api/v1/ged/documentos/${documentoId}/arquivo?versao=${v.id}`} download>Baixar</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
