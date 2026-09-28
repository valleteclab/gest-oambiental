import { prisma } from "@/lib/db";
import { fmtData, fmtDataCivil, fmtMoeda } from "@/lib/format";
import { COR_STATUS_COBRANCA, ehSimulada, ROTULO_STATUS_COBRANCA, rotuloForma, rotuloTaxa, STATUS_EM_ABERTO } from "@/lib/cobranca/regras";
import { Badge } from "@/components/ui";
import { SimularPagamentoRequerente } from "./acoes-cobranca";
import { BotaoCopiar } from "./pagamento";

/**
 * Taxas do processo para o requerente ("Meus processos"): valor, vencimento, situação, QR Pix (imagem base64),
 * "Copiar código Pix", linha digitável e link da fatura/boleto. A página já validou a titularidade.
 */
export async function TaxasRequerente({ processoId }: { processoId: string }) {
  const cobrancas = await prisma.cobranca.findMany({ where: { processo_id: processoId, status: { not: "CANCELADA" } }, orderBy: { created_at: "asc" } });
  if (!cobrancas.length) return null;
  const abertas = cobrancas.filter((c) => STATUS_EM_ABERTO.includes(c.status));
  return (
    <section className={abertas.length ? "rounded-lg border-2 border-sky-300 bg-sky-50 p-4" : "card p-4"} aria-labelledby="titulo-taxas" data-testid="taxas-requerente">
      <h2 id="titulo-taxas" className="mb-1 text-lg font-semibold">{abertas.length ? "Taxa a pagar" : "Taxas"}</h2>
      {abertas.length > 0 && <p className="mb-3 text-sm text-slate-700">Pague por Pix (QR Code ou código copia e cola) ou boleto. A confirmação é automática e o processo segue para a próxima etapa.</p>}
      <ul className="space-y-4">
        {cobrancas.map((c) => {
          const aberta = STATUS_EM_ABERTO.includes(c.status);
          const simulada = ehSimulada(c.asaas_payment_id);
          return (
            <li key={c.id} className="rounded-md border border-slate-200 bg-white p-3" data-testid="cobranca-requerente" data-status={c.status}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{rotuloTaxa(c.fase)} · {c.numero}</p>
                  <p className="text-sm text-slate-600">Vencimento: {fmtDataCivil(c.vencimento)}</p>
                  {c.status === "PAGA" && <p className="text-sm text-emerald-800">Pago em {fmtData(c.pago_em)} ({rotuloForma(c.forma_pagamento)})</p>}
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold">{fmtMoeda(c.valor)}</p>
                  <Badge cor={COR_STATUS_COBRANCA[c.status]}>{ROTULO_STATUS_COBRANCA[c.status]}</Badge>
                </div>
              </div>
              {aberta && (
                <div className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr]">
                  {c.pix_qr_base64 && (
                    // eslint-disable-next-line @next/next/no-img-element -- imagem base64 do QR Pix (data URI)
                    <img src={`data:image/png;base64,${c.pix_qr_base64}`} alt={`QR Code Pix da cobrança ${c.numero}`} width={180} height={180} className="h-44 w-44 rounded border border-slate-200 bg-white" data-testid="pix-qr" />
                  )}
                  <div className="min-w-0 space-y-3 text-sm">
                    {simulada && <p className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">Homologação: código Pix e linha digitável FICTÍCIOS – não pague.</p>}
                    {c.pix_copia_cola && (
                      <div>
                        <p className="label">Pix copia e cola</p>
                        <p className="break-all rounded bg-slate-50 p-2 font-mono text-xs" data-testid="pix-copia-cola">{c.pix_copia_cola}</p>
                        <div className="mt-1"><BotaoCopiar texto={c.pix_copia_cola} rotulo="Copiar código Pix" testid="copiar-pix" /></div>
                      </div>
                    )}
                    {c.linha_digitavel && (
                      <div>
                        <p className="label">Linha digitável do boleto</p>
                        <p className="break-all font-mono text-xs" data-testid="linha-digitavel">{c.linha_digitavel}</p>
                        <div className="mt-1"><BotaoCopiar texto={c.linha_digitavel.replace(/\D/g, "")} rotulo="Copiar linha digitável" /></div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {c.invoice_url && <a className="btn-primario btn-sm" href={c.invoice_url} target="_blank" rel="noopener noreferrer">Pagar (Pix, boleto ou cartão)</a>}
                      {c.boleto_url && <a className="btn-secundario btn-sm" href={c.boleto_url} target="_blank" rel="noopener noreferrer">Abrir boleto</a>}
                    </div>
                    {!c.pix_copia_cola && !c.linha_digitavel && !c.invoice_url && <p className="text-slate-700">Os dados de pagamento estão sendo gerados. Em caso de dúvida, fale com o órgão ambiental (contato abaixo).</p>}
                    {simulada && <SimularPagamentoRequerente id={c.id} processoId={processoId} />}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
