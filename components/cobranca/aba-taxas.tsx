import { prisma } from "@/lib/db";
import { fmtData, fmtDataCivil, fmtDataHora, fmtMoeda } from "@/lib/format";
import type { UsuarioSessao } from "@/lib/rbac";
import { COR_STATUS_COBRANCA, ehSimulada, FASES, fasesQueBloqueiam, mensagemBloqueio, ROTULO_STATUS_COBRANCA, rotuloForma, rotuloTaxa, STATUS_EM_ABERTO } from "@/lib/cobranca/regras";
import { configAtiva, modoGateway, podeGerirCobrancas } from "@/lib/cobranca/servico";
import { Aviso, Badge, Card, Vazio } from "@/components/ui";
import { AcoesCobranca, GerarCobranca } from "./acoes-cobranca";
import { BotaoCopiar } from "./pagamento";

/** Aviso de bloqueio por taxa em aberto (cabeçalho do processo). Nada quando o município não exige pagamento. */
export async function AvisoTaxaPendente({ processo }: { processo: { id: string; municipio_id: string; status: string } }) {
  const acao = { EM_TRIAGEM: "aceitar", PROTOCOLADO: "aceitar", AGUARDANDO_VISTORIA: "concluir_vistoria", DEFERIDO: "emitir_documento" }[processo.status];
  if (!acao) return null;
  const cfg = await configAtiva(processo.municipio_id);
  if (!cfg?.exige_pagamento) return null;
  const c = await prisma.cobranca.findFirst({ where: { processo_id: processo.id, fase: { in: fasesQueBloqueiam(acao) }, status: { in: STATUS_EM_ABERTO } }, orderBy: { created_at: "asc" } });
  if (!c) return null;
  return (
    <div className="mt-3" data-testid="aviso-taxa-pendente">
      <Aviso tipo="alerta">{mensagemBloqueio(c)} Veja a aba “Taxas”.</Aviso>
    </div>
  );
}

/** Aba "Taxas" da ficha interna do processo: cobranças, Pix/boleto, ações (baixa, isenção, cancelamento…). */
export async function AbaTaxas({ processo, usuario, somenteLeitura }: { processo: { id: string; municipio_id: string; status: string; valor_taxa: unknown; taxa_paga: boolean }; usuario: UsuarioSessao; somenteLeitura: boolean }) {
  const [cobrancas, cfg] = await Promise.all([
    prisma.cobranca.findMany({ where: { processo_id: processo.id }, orderBy: { created_at: "asc" } }),
    prisma.configCobranca.findUnique({ where: { municipio_id: processo.municipio_id } }),
  ]);
  const baixadores = [...new Set(cobrancas.map((c) => c.baixa_por).filter((x): x is string => !!x))];
  const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: baixadores } }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]));
  const gerir = !somenteLeitura && podeGerirCobrancas(usuario, processo.municipio_id);
  const ativas = new Set(cobrancas.filter((c) => c.status !== "CANCELADA").map((c) => c.fase));
  const fasesLivres = ativas.has("UNICA") ? [] : FASES.filter((f) => !ativas.has(f) && (f !== "UNICA" || ativas.size === 0));
  return (
    <Card titulo="Taxas" acoes={processo.valor_taxa ? <span className="text-sm">Total: <strong>{fmtMoeda(processo.valor_taxa as number)}</strong> · <Badge cor={processo.taxa_paga ? "verde" : "amarelo"}>{processo.taxa_paga ? "quitado" : "em aberto"}</Badge></span> : null}>
      {!cfg?.ativo && <div className="mb-3"><Aviso tipo="info">A cobrança de taxas não está ativa neste município{cfg ? "" : " (Administração → Cobrança)"}.</Aviso></div>}
      {cfg?.ativo && modoGateway(cfg) === "SIMULADO" && <div className="mb-3"><Aviso tipo="alerta">Ambiente de homologação: Pix e linha digitável são fictícios (não pagar). Use “Simular pagamento”.</Aviso></div>}
      {cobrancas.length === 0 ? <Vazio>Nenhuma cobrança para este processo.</Vazio> : (
        <ul className="space-y-4" data-testid="lista-cobrancas">
          {cobrancas.map((c) => {
            const aberta = STATUS_EM_ABERTO.includes(c.status);
            return (
              <li key={c.id} className="rounded-md border border-slate-200 p-3" data-testid="cobranca-item" data-status={c.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.numero} · {rotuloTaxa(c.fase)}</p>
                    <p className="text-xs text-slate-600">{c.descricao}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{fmtMoeda(c.valor)}</p>
                    <Badge cor={COR_STATUS_COBRANCA[c.status]}>{ROTULO_STATUS_COBRANCA[c.status]}</Badge>
                  </div>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <div><dt className="inline text-slate-500">Vencimento: </dt><dd className="inline">{fmtDataCivil(c.vencimento)}</dd></div>
                  <div><dt className="inline text-slate-500">Gateway: </dt><dd className="inline">{c.gateway === "MANUAL" ? "guia manual" : ehSimulada(c.asaas_payment_id) ? "simulado" : c.asaas_payment_id ? `Asaas ${c.asaas_payment_id}` : "Asaas (não registrado)"}</dd></div>
                  <div><dt className="inline text-slate-500">Gerada em: </dt><dd className="inline">{fmtDataHora(c.created_at)}</dd></div>
                  {c.status === "PAGA" && <div className="sm:col-span-3"><dt className="inline text-slate-500">Pagamento: </dt><dd className="inline">{fmtMoeda(c.valor_pago)} em {fmtData(c.pago_em)} ({rotuloForma(c.forma_pagamento)}){c.baixa_manual ? ` · baixa manual por ${nomes.get(c.baixa_por ?? "") ?? "—"}: ${c.baixa_motivo}` : ""}{c.comprovante_key ? <> · <a className="text-primaria-700 hover:underline" href={`/api/v1/cobrancas/${c.id}/comprovante`}>comprovante</a></> : null}</dd></div>}
                  {c.status === "ISENTA" && <div className="sm:col-span-3"><dt className="inline text-slate-500">Isenção: </dt><dd className="inline">{c.baixa_motivo} ({nomes.get(c.baixa_por ?? "") ?? "—"}, {fmtData(c.pago_em)})</dd></div>}
                  {c.status === "CANCELADA" && <div className="sm:col-span-3"><dt className="inline text-slate-500">Cancelamento: </dt><dd className="inline">{c.cancelado_motivo}</dd></div>}
                </dl>
                {c.erro_gateway && aberta && <div className="mt-2"><Aviso tipo="erro">Gateway: {c.erro_gateway}</Aviso></div>}
                {aberta && (c.invoice_url || c.pix_copia_cola || c.linha_digitavel) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    {c.invoice_url && <a className="btn-secundario btn-sm" href={c.invoice_url} target="_blank" rel="noopener noreferrer">Abrir fatura</a>}
                    {c.pix_copia_cola && <BotaoCopiar texto={c.pix_copia_cola} rotulo="Copiar código Pix" />}
                    {c.linha_digitavel && <span className="font-mono text-xs">{c.linha_digitavel}</span>}
                  </div>
                )}
                {aberta && gerir && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <AcoesCobranca gerir={gerir} c={{ id: c.id, numero: c.numero, processo_id: processo.id, aberta, simulada: ehSimulada(c.asaas_payment_id), erroGateway: !!c.erro_gateway, gatewayAsaas: c.gateway === "ASAAS", semRegistro: !c.asaas_payment_id }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {gerir && cfg?.ativo && fasesLivres.length > 0 && !["RASCUNHO", "ARQUIVADO"].includes(processo.status) && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold">Gerar cobrança manualmente</h3>
          <p className="mb-2 text-xs text-slate-500">Sem valor informado usa a tabela de taxas. As cobranças são geradas automaticamente no protocolo, na vistoria e no deferimento.</p>
          <GerarCobranca processoId={processo.id} fases={fasesLivres.map((f) => ({ valor: f, rotulo: rotuloTaxa(f) }))} />
        </div>
      )}
    </Card>
  );
}
