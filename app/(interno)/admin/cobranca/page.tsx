import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { decifrar } from "@/lib/crypto";
import { mascararChave } from "@/lib/cobranca/regras";
import { modoGateway, pagamentosSimulados, type ModoGateway } from "@/lib/cobranca/servico";
import { urlWebhookAsaas } from "@/lib/cobranca/webhook-url";
import { AcessoNegado } from "@/components/acesso-negado";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../_comp/form-admin";
import { AreaTexto, Marcador, Selecao, Texto } from "../_comp/campos";
import { gerarTokenWebhook, registrarWebhookAsaas, salvarConfigCobranca, sincronizarAgora, testarConexaoAsaas } from "./actions";

export const metadata = { title: "Cobrança de taxas – Administração" };
export const dynamic = "force-dynamic";

const ROTULO_MODO: Record<ModoGateway, { texto: string; cor: "verde" | "amarelo" | "vermelho" | "azul" | "cinza" }> = {
  ASAAS: { texto: "Asaas", cor: "verde" },
  SIMULADO: { texto: "Simulado (homologação)", cor: "amarelo" },
  MANUAL: { texto: "Guia manual (sem gateway)", cor: "azul" },
  SEM_CHAVE: { texto: "Sem chave da API", cor: "vermelho" },
};

export default async function PaginaCobranca() {
  const { u, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado mensagem="A configuração da cobrança é restrita ao administrador." />;
  const municipios = await prisma.municipio.findMany({ where: whereMunicipiosAdmin(u), orderBy: { nome: "asc" }, select: { id: true, nome: true, sigla: true, ativo: true, config_cobranca: true } });
  return (
    <div className="space-y-6">
      <CabecalhoPagina
        titulo="Cobrança de taxas (Pix/boleto)"
        subtitulo={<><Link href="/admin" className="underline">Administração</Link> · conta Asaas de cada prefeitura – o valor pago cai direto na conta do município · <Link href="/admin/taxas" className="underline">Tabela de taxas</Link> · <Link href="/financeiro" className="underline">Financeiro</Link></>}
      />
      <Aviso tipo="info">
        A taxa precisa estar instituída em <strong>lei municipal</strong> (informe a base legal nas instruções e na tabela de taxas). Sem configuração ativa o município não gera cobranças e o fluxo dos processos não muda. Passo a passo: <code>docs/cobranca.md</code>.
        {pagamentosSimulados() && <> <strong>PAGAMENTOS_SIMULADO=true</strong>: nenhum município chama o Asaas neste ambiente.</>}
      </Aviso>
      {municipios.map((m) => {
        const c = m.config_cobranca;
        const chave = mascararChave(decifrar(c?.asaas_api_key_cifrada));
        const modo = c ? modoGateway(c) : null;
        return (
          <Card
            key={m.id}
            titulo={`${m.nome} (${m.sigla})`}
            acoes={
              <span className="flex flex-wrap gap-2" data-testid={`status-cobranca-${m.sigla}`}>
                <Badge cor={c?.ativo ? "verde" : "cinza"}>{c?.ativo ? "Cobrança ativa" : "Desligada"}</Badge>
                {c && modo && <Badge cor={ROTULO_MODO[modo].cor}>{ROTULO_MODO[modo].texto}</Badge>}
              </span>
            }
          >
            <FormAdmin action={salvarConfigCobranca} rotuloAcessivel={`Cobrança de ${m.nome}`}>
              <input type="hidden" name="municipio_id" value={m.id} />
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Marcador name="ativo" label="Cobrança ativa (gera cobranças nos processos)" defaultChecked={c?.ativo ?? false} />
                <Marcador name="exige_pagamento" label="Bloquear a etapa seguinte até o pagamento" defaultChecked={c?.exige_pagamento ?? true} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Selecao name="gateway" label="Gateway" defaultValue={c?.gateway ?? "ASAAS"} opcoes={[{ valor: "ASAAS", rotulo: "Asaas (Pix, boleto e cartão)" }, { valor: "MANUAL", rotulo: "Sem gateway – baixa manual" }]} />
                <Texto
                  name="asaas_api_key"
                  label="Chave da API do Asaas"
                  type="password"
                  autoComplete="off"
                  placeholder={chave ? `${chave} configurada` : "$aact_…"}
                  dica={chave ? "Deixe em branco para manter a chave atual." : "Asaas → Integrações → Chave de API. Sem chave em sandbox = simulação."}
                  className="sm:col-span-2"
                />
                <Texto name="dias_vencimento" label="Vencimento (dias)" type="number" min={1} max={90} defaultValue={c?.dias_vencimento ?? 10} required />
                <Texto name="multa_percentual" label="Multa após vencimento (%)" inputMode="decimal" defaultValue={c?.multa_percentual?.toString() ?? ""} dica="Máx. 2% (CDC)." />
                <Texto name="juros_mensal_percentual" label="Juros ao mês (%)" inputMode="decimal" defaultValue={c?.juros_mensal_percentual?.toString() ?? ""} dica="Máx. 1% a.m." />
                <div className="flex flex-col justify-end gap-2 pb-1 sm:col-span-2">
                  <Marcador name="asaas_sandbox" label="Sandbox (homologação)" defaultChecked={c?.asaas_sandbox ?? true} />
                  {chave && <Marcador name="remover_chave" label="Remover a chave salva" />}
                </div>
              </div>
              <AreaTexto name="instrucoes" label="Instruções / base legal (vai na descrição da cobrança)" rows={2} maxLength={1000} defaultValue={c?.instrucoes ?? ""} placeholder="Taxa de licenciamento ambiental – Lei Municipal nº …/…, art. …" />
            </FormAdmin>

            <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold">Webhook (confirmação automática do pagamento)</h3>
              {c?.asaas_webhook_token ? (
                <p className="break-all rounded bg-slate-50 p-2 font-mono text-xs" data-testid={`webhook-url-${m.sigla}`}>{urlWebhookAsaas(c.asaas_webhook_token)}</p>
              ) : (
                <p className="text-sm text-slate-600">Nenhum token gerado.</p>
              )}
              <p className="text-xs text-slate-500">No Asaas (Integrações → Webhooks) use esta URL e o mesmo token como “Token de autenticação” – ou clique em “Registrar webhook no Asaas”. Eventos: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_REFUNDED.</p>
              <div className="flex flex-wrap items-start gap-2">
                <FormAdmin action={gerarTokenWebhook} inline botao={c?.asaas_webhook_token ? "Gerar novo token" : "Gerar token"} classeBotao="btn-secundario" confirmar={c?.asaas_webhook_token ? "Gerar um novo token invalida o webhook atual. Continuar?" : undefined} rotuloAcessivel="Gerar token do webhook">
                  <input type="hidden" name="municipio_id" value={m.id} />
                </FormAdmin>
                {chave && (
                  <>
                    <FormAdmin action={testarConexaoAsaas} inline botao="Testar conexão" classeBotao="btn-secundario" rotuloAcessivel="Testar conexão com o Asaas">
                      <input type="hidden" name="municipio_id" value={m.id} />
                    </FormAdmin>
                    {c?.asaas_webhook_token && (
                      <FormAdmin action={registrarWebhookAsaas} inline botao="Registrar webhook no Asaas" classeBotao="btn-secundario" rotuloAcessivel="Registrar webhook no Asaas">
                        <input type="hidden" name="municipio_id" value={m.id} />
                      </FormAdmin>
                    )}
                  </>
                )}
                {c?.ativo && (
                  <FormAdmin action={sincronizarAgora} inline botao="Sincronizar pendentes agora" classeBotao="btn-secundario" rotuloAcessivel="Sincronizar cobranças pendentes">
                    <input type="hidden" name="municipio_id" value={m.id} />
                  </FormAdmin>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
