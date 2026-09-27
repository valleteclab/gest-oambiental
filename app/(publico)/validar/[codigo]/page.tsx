import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { documentoPorCodigo } from "@/lib/documentos/publico";
import { normalizarCodigo, ROTULO_STATUS_PUBLICO, type StatusPublico } from "@/lib/documentos/render";
import { fmtData, fmtDataHora } from "@/lib/format";
import { Aviso } from "@/components/ui";
import { CompararPdf } from "./comparar-pdf";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Validação de documento", robots: { index: false } };

const ESTILO: Record<StatusPublico, { caixa: string; icone: string; texto: string }> = {
  VALIDO: { caixa: "border-emerald-600 bg-emerald-50 text-emerald-900", icone: "✔", texto: "Documento autêntico e válido." },
  VENCIDO: { caixa: "border-amber-500 bg-amber-50 text-amber-900", icone: "!", texto: "Documento autêntico, mas com prazo de validade expirado." },
  CANCELADO: { caixa: "border-red-600 bg-red-50 text-red-900", icone: "✖", texto: "Documento autêntico, porém CANCELADO pelo órgão emissor. Não produz efeitos." },
  SUBSTITUIDO: { caixa: "border-orange-500 bg-orange-50 text-orange-900", icone: "↻", texto: "Documento autêntico, porém SUBSTITUÍDO por outro. Utilize o documento substituto." },
};

export default async function ValidarCodigoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo: bruto } = await params;
  const codigo = normalizarCodigo(decodeURIComponent(bruto));
  const d = codigo ? await documentoPorCodigo(codigo) : null;

  if (!d) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="titulo-pagina">Validação de documento</h1>
        <div className="rounded-lg border-2 border-red-600 bg-red-50 p-5 text-red-900" role="alert">
          <p className="text-2xl font-bold" data-testid="status-documento">NÃO ENCONTRADO</p>
          <p className="mt-1 text-sm">Nenhum documento foi emitido com o código <span className="font-mono">{codigo ?? decodeURIComponent(bruto)}</span>. Confira a digitação. Documento sem registro pode ser falso.</p>
        </div>
        <Link href="/validar" className="btn-secundario">Validar outro código</Link>
      </div>
    );
  }

  const e = ESTILO[d.status];
  const linhas: [string, React.ReactNode][] = [
    ["Tipo de documento", d.titulo !== d.tipo_rotulo ? `${d.titulo} (${d.tipo_rotulo})` : d.tipo_rotulo],
    ["Número", <span key="n" className="font-semibold">{d.numero}</span>],
    ["Titular", d.titular ? `${d.titular.nome} – ${d.titular.documento}` : "—"],
    ["Empreendimento", d.empreendimento ?? "—"],
    ["Processo", d.processo_numero ? <Link key="p" className="text-primaria-700 underline" href={`/consulta?numero=${encodeURIComponent(d.processo_numero)}`}>{d.processo_numero}</Link> : "—"],
    ["Município / órgão emissor", `${d.municipio} – ${d.orgao}`],
    ["Emitido em", `${fmtDataHora(d.emitido_em)} por ${d.emitido_por}`],
    ["Validade", d.validade_ate ? fmtData(d.validade_ate) : "Não se aplica"],
    ["Código verificador", <span key="c" className="font-mono">{d.codigo_verificador}</span>],
    ["Hash SHA-256 do PDF original", <span key="h" className="break-all font-mono text-xs" data-testid="hash-documento">{d.sha256_pdf}</span>],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="titulo-pagina">Validação de documento</h1>

      <div className={clsx("flex items-start gap-4 rounded-lg border-2 p-5", e.caixa)} role="status" aria-live="polite">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/70 text-3xl font-bold">{e.icone}</span>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide">Situação do documento</p>
          <p className="text-3xl font-extrabold tracking-wide sm:text-4xl" data-testid="status-documento">{ROTULO_STATUS_PUBLICO[d.status]}</p>
          <p className="mt-1 text-sm">{e.texto}</p>
          {(d.status === "CANCELADO" || d.status === "SUBSTITUIDO") && d.motivo_cancelamento && (
            <p className="mt-2 text-sm" data-testid="motivo-cancelamento"><strong>Motivo:</strong> {d.motivo_cancelamento}{d.cancelado_em ? ` (em ${fmtData(d.cancelado_em)})` : ""}</p>
          )}
          {d.substituto && (
            <p className="mt-2 text-sm">
              Documento substituto: <Link className="font-semibold underline" href={`/validar/${d.substituto.codigo_verificador}`}>{d.substituto.numero}</Link>
            </p>
          )}
        </div>
      </div>

      <section className="card" aria-labelledby="dados-doc">
        <h2 id="dados-doc" className="border-b border-slate-100 px-4 py-3 text-base font-semibold">Dados do documento</h2>
        <dl className="divide-y divide-slate-100">
          {linhas.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-slate-600">{k}</dt>
              <dd className="text-sm text-slate-900 sm:col-span-2">{v}</dd>
            </div>
          ))}
        </dl>
        {d.pdf_publico && (
          <div className="border-t border-slate-100 px-4 py-3">
            <a className="btn-secundario" href={`/api/v1/documentos/${d.id}/pdf`} target="_blank" rel="noopener">Ver PDF original</a>
          </div>
        )}
      </section>

      <section className="card p-4">
        <CompararPdf hashEsperado={d.sha256_pdf} />
      </section>

      <Aviso>
        Dados pessoais exibidos de forma mascarada conforme a LGPD. A autenticidade é garantida pelo código verificador e pelo hash SHA-256 do arquivo original, registrados no momento da emissão.
      </Aviso>
      <Link href="/validar" className="btn-secundario">Validar outro código</Link>
    </div>
  );
}
