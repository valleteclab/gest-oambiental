import Link from "next/link";
import { forbidden } from "next/navigation";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { lerConfiguracoes } from "@/lib/ged/admin/configuracoes";
import { cotaOcrDoMes } from "@/lib/ged/ocr/servico";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed } from "@/lib/ged/papeis";
import { lerConfigProtocolo, type AssuntoView, type ConfigProtocoloView } from "@/lib/ged/protocolo/config";
import { PRIORIDADES, ROTULO_PRIORIDADE } from "@/lib/ged/protocolo/regras";
import { alternarAssuntoAction, atualizarAssuntoAction, criarAssuntoAction, excluirAssuntoAction, salvarConfiguracoesAction, salvarProtocoloAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurações – Gestão de Documentos" };

export default async function PaginaConfiguracoes() {
  const ctx = await exigirGed();
  if (!podeAdministrarGed(ctx)) forbidden();
  const c = await lerConfiguracoes(ctx);
  const ocr = await cotaOcrDoMes(ctx.db);
  const prot = await lerConfigProtocolo(ctx);

  return (
    <>
      <CabecalhoPagina titulo="Configurações" subtitulo={<><Link href="/ged/admin" prefetch={false} className="underline">Administração</Link> · padrões do seu cliente no módulo</>} />
      <Card className="max-w-2xl">
        <FormGed action={salvarConfiguracoesAction} botao="Salvar configurações" rotuloAcessivel="Configurações do cliente">
          <div>
            <label className="label" htmlFor="cfg-prazo">Prazo padrão de assinatura (dias)</label>
            <input id="cfg-prazo" name="assinatura_prazo_dias" type="number" min={1} max={365} step={1} className="input" defaultValue={c.assinatura_prazo_dias} required />
            <span className="mt-1 block text-xs text-slate-500">Sugerido ao abrir uma solicitação de assinatura; vencido o prazo, a solicitação expira.</span>
          </div>
          <div>
            <label className="label" htmlFor="cfg-lembretes">Lembretes de assinatura (dias antes do prazo)</label>
            <input id="cfg-lembretes" name="lembrete_dias" className="input" defaultValue={c.lembrete_dias.join(", ")} maxLength={60} required />
            <span className="mt-1 block text-xs text-slate-500">Números separados por vírgula; 0 = no dia do vencimento. Ex.: 3, 1, 0.</span>
          </div>
          <div>
            <label className="label" htmlFor="cfg-retencao">Retenção do log de acessos (dias)</label>
            <input id="cfg-retencao" name="retencao_acesso_log_dias" type="number" min={90} max={3650} step={1} className="input" defaultValue={c.retencao_acesso_log_dias} required />
            <span className="mt-1 block text-xs text-slate-500">Acessos mais antigos são apagados automaticamente (mínimo de 90 dias). Alterações e comunicações não são apagadas.</span>
          </div>
          <div>
            <label className="label" htmlFor="cfg-cota">Cota de armazenamento informativa (GB)</label>
            <input id="cfg-cota" name="cota_gb" inputMode="decimal" className="input" defaultValue={c.cota_gb ?? ""} placeholder="Sem cota definida" />
            <span className="mt-1 block text-xs text-slate-500">Apenas informativa nesta fase: não bloqueia envios.</span>
          </div>
          <div>
            <label className="label" htmlFor="cfg-ocr">Cota mensal de OCR (páginas)</label>
            <input id="cfg-ocr" name="ocr_cota_paginas_mes" inputMode="numeric" className="input" defaultValue={c.ocr_cota_paginas_mes ?? ""} placeholder="Sem limite" />
            <span className="mt-1 block text-xs text-slate-500" data-testid="ocr-uso">
              Páginas de documentos digitalizados que o servidor reconhece por mês (OCR, para a busca achar o texto). Vazio = sem limite; 0 = OCR desligado.
              Uso neste mês: {ocr.usadas}{ocr.cota !== null ? ` de ${ocr.cota}` : ""} página(s). Ao atingir a cota, os novos digitalizados ficam como &ldquo;OCR: cota excedida&rdquo; até o mês seguinte ou até a cota ser aumentada e o OCR reprocessado.
            </span>
          </div>
        </FormGed>
      </Card>
      <ProtocoloOnline cfg={prot} />
    </>
  );
}

function CamposAssunto({ cfg, a, sufixo }: { cfg: ConfigProtocoloView; a?: AssuntoView; sufixo: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`as-nome-${sufixo}`}>Nome do assunto *</label>
        <input id={`as-nome-${sufixo}`} name="nome" className="input" required minLength={3} maxLength={120} defaultValue={a?.nome ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`as-desc-${sufixo}`}>Explicação para o cidadão (opcional)</label>
        <input id={`as-desc-${sufixo}`} name="descricao" className="input" maxLength={300} defaultValue={a?.descricao ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor={`as-setor-${sufixo}`}>Setor de destino *</label>
        <select id={`as-setor-${sufixo}`} name="destino_setor_id" className="input" required defaultValue={a?.destino_setor_id ?? ""}>
          <option value="" disabled>Selecione…</option>
          {cfg.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`as-tipo-${sufixo}`}>Tipo de documento</label>
        <select id={`as-tipo-${sufixo}`} name="tipo_documento_id" className="input" defaultValue={a?.tipo_documento_id ?? ""}>
          <option value="">Sem tipo</option>
          {cfg.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`as-prio-${sufixo}`}>Prioridade</label>
        <select id={`as-prio-${sufixo}`} name="prioridade" className="input" defaultValue={a?.prioridade ?? "NORMAL"}>
          {PRIORIDADES.map((p) => <option key={p} value={p}>{ROTULO_PRIORIDADE[p]}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`as-prazo-${sufixo}`}>Prazo de resposta (dias)</label>
        <input id={`as-prazo-${sufixo}`} name="prazo_dias" type="number" min={1} max={365} className="input" defaultValue={a?.prazo_dias ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor={`as-ordem-${sufixo}`}>Ordem na lista</label>
        <input id={`as-ordem-${sufixo}`} name="ordem" type="number" min={0} max={999} className="input" defaultValue={a?.ordem ?? 0} />
      </div>
    </div>
  );
}

function ProtocoloOnline({ cfg }: { cfg: ConfigProtocoloView }) {
  return (
    <div className="mt-6 max-w-2xl space-y-6" id="protocolo-online">
      <Card titulo="Protocolo online (portal do cidadão)">
        <p className="mb-4 text-sm text-slate-600">
          Permite que o cidadão ou fornecedor entregue documentos ao órgão sem login, em uma página pública do órgão, e acompanhe o andamento com o número e um código de consulta.
          O recurso vem <strong>desligado</strong>. Cada protocolo recebido pelo portal gera um comprovante em PDF e um e-mail de confirmação.
        </p>
        <FormGed action={salvarProtocoloAction} botao="Salvar protocolo online" rotuloAcessivel="Configuração do protocolo online">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="portal_ativo" defaultChecked={cfg.portal_ativo} className="accent-emerald-700" data-testid="portal-ativo" /> Ligar o protocolo online
          </label>
          <div>
            <label className="label" htmlFor="pt-slug">Endereço público do órgão</label>
            <input id="pt-slug" name="slug" className="input" defaultValue={cfg.slug ?? ""} maxLength={60} placeholder="ex.: camara-municipal" autoComplete="off" />
            <span className="mt-1 block text-xs text-slate-500">Só letras minúsculas, números e hífen. O portal fica em <code>/protocolo/&lt;endereço&gt;</code>{cfg.url_publica ? <> — hoje: <a className="underline" href={cfg.url_publica} target="_blank" rel="noopener noreferrer">{cfg.url_publica}</a></> : null}.</span>
          </div>
          <div>
            <label className="label" htmlFor="pt-resp">Responsável pelos documentos recebidos</label>
            <select id="pt-resp" name="responsavel_id" className="input" defaultValue={cfg.responsavel_id ?? ""}>
              <option value="">Selecione…</option>
              {cfg.responsaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">Os PDFs enviados pelo público viram documentos restritos criados por esta pessoa e são encaminhados ao setor do assunto escolhido.</span>
          </div>
          <div>
            <label className="label" htmlFor="pt-orient">Texto de orientação ao cidadão</label>
            <textarea id="pt-orient" name="orientacao" className="input min-h-24" rows={4} maxLength={2000} defaultValue={cfg.orientacao ?? ""} placeholder="Ex.: horários de atendimento, documentos que devem ser anexados, prazos…" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="pt-max-anexos">Máximo de arquivos por protocolo</label>
              <input id="pt-max-anexos" name="max_anexos" type="number" min={0} max={10} className="input" defaultValue={cfg.max_anexos} required />
            </div>
            <div>
              <label className="label" htmlFor="pt-max-mb">Tamanho máximo por arquivo (MB)</label>
              <input id="pt-max-mb" name="max_mb" type="number" min={1} max={25} className="input" defaultValue={cfg.max_mb} required />
            </div>
          </div>
        </FormGed>
      </Card>

      <Card titulo={`Assuntos oferecidos ao público (${cfg.assuntos.length})`}>
        <p className="mb-3 text-sm text-slate-600">O cidadão escolhe o assunto, nunca o destino: cada assunto leva o protocolo ao setor indicado, com a prioridade e o prazo de resposta configurados.</p>
        {cfg.assuntos.length === 0 ? <p className="mb-4 text-sm text-slate-600">Nenhum assunto cadastrado. Cadastre ao menos um para ligar o portal.</p> : (
          <ul className="mb-4 space-y-2" data-testid="assuntos-protocolo">
            {cfg.assuntos.map((a) => (
              <li key={a.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{a.nome} {!a.ativo && <span className="text-xs font-normal text-slate-500">(inativo)</span>}</div>
                    <div className="text-xs text-slate-500">Destino: {a.destino_setor ?? "—"} · {ROTULO_PRIORIDADE[a.prioridade]}{a.prazo_dias ? ` · prazo ${a.prazo_dias} dia(s)` : ""}</div>
                  </div>
                  <div className="flex gap-2">
                    <FormGed action={alternarAssuntoAction} inline botao={a.ativo ? "Desativar" : "Ativar"} classeBotao="btn-secundario" rotuloAcessivel={`${a.ativo ? "Desativar" : "Ativar"} ${a.nome}`}>
                      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="ativo" value={a.ativo ? "false" : "true"} />
                    </FormGed>
                    <FormGed action={excluirAssuntoAction} inline botao="Excluir" classeBotao="btn-perigo" confirmar={`Excluir o assunto "${a.nome}"?`} rotuloAcessivel={`Excluir ${a.nome}`}>
                      <input type="hidden" name="id" value={a.id} />
                    </FormGed>
                  </div>
                </div>
                <details className="mt-2"><summary className="cursor-pointer text-sm text-primaria-700">Editar</summary>
                  <FormGed action={atualizarAssuntoAction} botao="Salvar assunto" rotuloAcessivel={`Editar ${a.nome}`} className="mt-3">
                    <input type="hidden" name="id" value={a.id} />
                    <CamposAssunto cfg={cfg} a={a} sufixo={a.id} />
                  </FormGed>
                </details>
              </li>
            ))}
          </ul>
        )}
        <details open={cfg.assuntos.length === 0}><summary className="cursor-pointer text-sm font-medium text-primaria-700">Novo assunto</summary>
          <FormGed action={criarAssuntoAction} botao="Cadastrar assunto" limparAoSalvar rotuloAcessivel="Novo assunto do protocolo online" className="mt-3">
            <CamposAssunto cfg={cfg} sufixo="novo" />
          </FormGed>
        </details>
      </Card>
    </div>
  );
}
