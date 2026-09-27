import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { consultarProcessoPublico } from "@/lib/documentos/publico";
import { ROTULO_STATUS_PUBLICO } from "@/lib/documentos/render";
import { fmtData, fmtDataHora } from "@/lib/format";
import { Aviso, Badge, statusAmigavel } from "@/components/ui";
import type { StatusProcesso } from "@prisma/client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Consultar processo" };

const COR_STATUS = { VALIDO: "verde", VENCIDO: "amarelo", CANCELADO: "vermelho", SUBSTITUIDO: "amarelo" } as const;

export default async function ConsultaPage({ searchParams }: { searchParams: Promise<{ numero?: string; doc?: string }> }) {
  const { numero = "", doc = "" } = await searchParams;
  const buscou = !!numero.trim();
  const p = buscou ? await consultarProcessoPublico(numero, doc) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Consultar processo</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Informe o número completo do processo (ex.: ITB-2026-000042), que consta no recibo de protocolo. Opcionalmente, informe também o CPF/CNPJ do requerente para confirmar a titularidade.
        </p>
      </div>

      <form method="get" action="/consulta" className="card grid gap-4 p-5 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
        <label className="block" htmlFor="numero">
          <span className="label">Nº do processo</span>
          <input id="numero" name="numero" required defaultValue={numero} className="input font-mono uppercase" placeholder="ITB-2026-000042" autoComplete="off" spellCheck={false} maxLength={30} />
        </label>
        <label className="block" htmlFor="doc">
          <span className="label">CPF/CNPJ do requerente (opcional)</span>
          <input id="doc" name="doc" defaultValue={doc} className="input" inputMode="numeric" placeholder="Somente números" autoComplete="off" maxLength={20} />
        </label>
        <button type="submit" className="btn-primario">Consultar</button>
      </form>

      {buscou && !p && (
        <Aviso tipo="erro">Processo não encontrado. Confira o número completo{doc ? " e o CPF/CNPJ informado" : ""}. Por segurança, não fazemos busca parcial.</Aviso>
      )}

      {p && (
        <div className="space-y-6" data-testid="resultado-consulta">
          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">Processo</p>
                <p className="font-mono text-xl font-semibold" data-testid="numero-processo">{p.numero}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">Situação</p>
                <p className="text-lg font-semibold text-primaria-700" data-testid="situacao-processo">{statusAmigavel(p.status as StatusProcesso)}</p>
                <p className="text-xs text-slate-500">{p.status_detalhe}</p>
              </div>
            </div>
            {p.titularidade_confirmada && <p className="mt-2"><Badge cor="verde">Titularidade confirmada pelo CPF/CNPJ</Badge></p>}
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Requerente</dt><dd className="font-medium" data-testid="requerente">{p.requerente.nome} – <span data-testid="documento-mascarado">{p.requerente.documento}</span></dd></div>
              <div><dt className="text-slate-500">Empreendimento</dt><dd className="font-medium">{p.empreendimento}</dd></div>
              <div><dt className="text-slate-500">Modalidade</dt><dd className="font-medium">{p.tipo_ato}</dd></div>
              <div><dt className="text-slate-500">Município / órgão</dt><dd className="font-medium">{p.municipio} – {p.orgao}</dd></div>
              <div><dt className="text-slate-500">Protocolo</dt><dd className="font-medium">{fmtData(p.data_protocolo)}</dd></div>
              {p.data_conclusao && <div><dt className="text-slate-500">Conclusão</dt><dd className="font-medium">{fmtData(p.data_conclusao)}</dd></div>}
            </dl>
          </section>

          <section className="card p-5" aria-labelledby="tl">
            <h2 id="tl" className="text-base font-semibold">Linha do tempo</h2>
            {p.linha_do_tempo.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Sem movimentações públicas registradas.</p>
            ) : (
              <ol className="mt-4 space-y-0" data-testid="linha-do-tempo">
                {p.linha_do_tempo.map((t, i) => (
                  <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
                    <span aria-hidden="true" className={clsx("absolute left-[7px] top-4 h-full w-0.5 bg-slate-200", i === p.linha_do_tempo.length - 1 && "hidden")} />
                    <span aria-hidden="true" className={clsx("relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-white ring-2", i === p.linha_do_tempo.length - 1 ? "bg-primaria-600 ring-primaria-600" : "bg-slate-300 ring-slate-300")} />
                    <div>
                      <p className="text-sm font-medium">{t.etapa}</p>
                      <p className="text-xs text-slate-500"><time dateTime={new Date(t.data).toISOString()}>{fmtDataHora(t.data)}</time> · {t.situacao}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card p-5" aria-labelledby="docs">
            <h2 id="docs" className="text-base font-semibold">Documentos públicos emitidos</h2>
            {p.documentos.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nenhuma licença, autorização ou certidão emitida neste processo.</p>
            ) : (
              <div className="relative mt-3 overflow-x-auto">
                <table className="tabela">
                  <thead><tr><th scope="col">Documento</th><th scope="col">Número</th><th scope="col">Emissão</th><th scope="col">Validade</th><th scope="col">Situação</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
                  <tbody>
                    {p.documentos.map((d) => (
                      <tr key={d.codigo_verificador}>
                        <td>{d.titulo}</td>
                        <td className="font-mono whitespace-nowrap">{d.numero}</td>
                        <td>{fmtData(d.emitido_em)}</td>
                        <td>{fmtData(d.validade_ate)}</td>
                        <td><Badge cor={COR_STATUS[d.status]}>{ROTULO_STATUS_PUBLICO[d.status]}</Badge></td>
                        <td><Link className="text-primaria-700 underline" href={`/validar/${d.codigo_verificador}`}>Validar</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="text-xs text-slate-500">Despachos internos e dados pessoais não são exibidos no portal (LGPD). O requerente acompanha os detalhes na área logada.</p>
        </div>
      )}
    </div>
  );
}
