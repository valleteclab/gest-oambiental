"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Aviso, Badge } from "@/components/ui";
import { erroDaResposta } from "@/lib/fiscalizacao/cliente";

type CampoCfg = { k: string; rotulo: string; dica?: string };
type Tipo = { id: string; rotulo: string; campos: { publicos: CampoCfg[]; segredos: CampoCfg[] } };
type Canal = {
  id: string; tipo: string; nome: string; ativo: boolean; status_conexao: string | null; ultimo_evento_em: string | null; municipio: { nome: string; sigla: string } | null; municipio_id: string | null;
  conversas: number; config: Record<string, string>; segredos_definidos: string[]; webhook_url: string | null; webhook_url_sem_token: string | null; webhook_secret: string;
};

async function api(url: string, method: string, corpo?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
  if (!r.ok) throw new Error(await erroDaResposta(r));
  return r.json();
}

const INSTRUCOES: Record<string, string> = {
  WHATSAPP_EVOLUTION: "Clique em “Conectar / QR Code”: a instância é criada na Evolution API, o webhook é configurado automaticamente (header x-webhook-secret) e o QR Code aparece para ler no WhatsApp do órgão (Aparelhos conectados › Conectar aparelho).",
  WHATSAPP_ZAPI: "No painel da Z-API, em Webhooks › “Ao receber”, cole a URL do webhook (já contém o token). Ative “Notificar as enviadas por mim também” para detectar quando um atendente responde pelo celular. Em Segurança, gere o Client-Token e informe acima.",
  WHATSAPP_CHATWOOT: "No Chatwoot: Configurações › Integrações › Webhooks › Adicionar, cole a URL (com token) e marque “Mensagem criada”. Use o token de acesso de um agente-bot com acesso à caixa. Se a versão assinar webhooks (HMAC), informe o segredo.",
  EMAIL: "Configure o inbound do Postmark (Servers › Inbound › Webhook URL) ou do SendGrid (Inbound Parse) com a URL acima (com token). As respostas saem pelo SMTP do sistema com Reply-To no e-mail de entrada.",
  WEBCHAT: "O chat aparece em /denuncia e no portal do órgão (/orgao/SIGLA). Desative para mostrar só o formulário.",
};

export function PainelCanais({ canais, municipios, tipos }: { canais: Canal[]; municipios: { id: string; nome: string }[]; tipos: Tipo[] }) {
  const router = useRouter();
  const [novoTipo, setNovoTipo] = useState(tipos[0].id);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const tipo = tipos.find((t) => t.id === novoTipo)!;

  async function criar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const publicos: Record<string, string> = {};
    const segredos: Record<string, string> = {};
    for (const c of tipo.campos.publicos) publicos[c.k] = String(f.get(`p_${c.k}`) ?? "");
    for (const c of tipo.campos.segredos) segredos[c.k] = String(f.get(`s_${c.k}`) ?? "");
    setErro(null); setOk(null); setOcupado(true);
    try {
      await api("/api/v1/admin/canais", "POST", { tipo: novoTipo, nome: f.get("nome"), municipio_id: f.get("municipio_id") || null, publicos, segredos });
      setOk("Canal criado. Configure o webhook no provedor com a URL exibida.");
      (ev.target as HTMLFormElement).reset();
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3" data-testid="lista-canais">
        {canais.length === 0 && <li className="card p-4 text-sm text-slate-500">Nenhum canal cadastrado. O chat do site é criado automaticamente na primeira conversa de cada município.</li>}
        {canais.map((c) => <ItemCanal key={c.id} c={c} tipo={tipos.find((t) => t.id === c.tipo)!} municipios={municipios} />)}
      </ul>

      <details className="card p-4">
        <summary className="cursor-pointer font-semibold text-primaria-700">+ Novo canal</summary>
        <form onSubmit={criar} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="novo-tipo" className="label">Tipo</label>
            <select id="novo-tipo" className="input" value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)}>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="novo-nome" className="label">Nome</label>
            <input id="novo-nome" name="nome" className="input" required maxLength={120} placeholder="WhatsApp da Secretaria" />
          </div>
          <div>
            <label htmlFor="novo-mun" className="label">Município</label>
            <select id="novo-mun" name="municipio_id" className="input" defaultValue="">
              <option value="">Toda a organização (o assistente pergunta o município)</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          {tipo.campos.publicos.map((c) => (
            <div key={c.k}>
              <label htmlFor={`p_${c.k}`} className="label">{c.rotulo}</label>
              <input id={`p_${c.k}`} name={`p_${c.k}`} className="input" maxLength={500} />
              {c.dica && <span className="mt-1 block text-xs text-slate-500">{c.dica}</span>}
            </div>
          ))}
          {tipo.campos.segredos.map((c) => (
            <div key={c.k}>
              <label htmlFor={`s_${c.k}`} className="label">{c.rotulo}</label>
              <input id={`s_${c.k}`} name={`s_${c.k}`} type="password" autoComplete="off" className="input" maxLength={2000} />
              {c.dica && <span className="mt-1 block text-xs text-slate-500">{c.dica}</span>}
            </div>
          ))}
          <p className="text-xs text-slate-600 sm:col-span-2">{INSTRUCOES[novoTipo]}</p>
          <div className="sm:col-span-2"><button className="btn-primario" disabled={ocupado}>Criar canal</button></div>
        </form>
        {erro && <div className="mt-3"><Aviso tipo="erro">{erro}</Aviso></div>}
        {ok && <div className="mt-3"><Aviso tipo="sucesso">{ok}</Aviso></div>}
      </details>
    </div>
  );
}

function ItemCanal({ c, tipo, municipios }: { c: Canal; tipo: Tipo; municipios: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ t: "erro" | "sucesso" | "info"; m: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [destino, setDestino] = useState("");
  const [editar, setEditar] = useState(false);

  async function executar(fn: () => Promise<string | void>) {
    setMsg(null); setOcupado(true);
    try {
      const r = await fn();
      if (r) setMsg({ t: "sucesso", m: r });
      router.refresh();
    } catch (e) {
      setMsg({ t: "erro", m: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  async function salvar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const publicos: Record<string, string> = {};
    const segredos: Record<string, string> = {};
    for (const x of tipo.campos.publicos) publicos[x.k] = String(f.get(`p_${x.k}`) ?? "");
    for (const x of tipo.campos.segredos) { const v = String(f.get(`s_${x.k}`) ?? ""); if (v) segredos[x.k] = v; }
    await executar(async () => {
      await api(`/api/v1/admin/canais/${c.id}`, "PATCH", { nome: String(f.get("nome") ?? c.nome), municipio_id: c.tipo === "WEBCHAT" ? undefined : (String(f.get("municipio_id") ?? "") || null), publicos, segredos });
      setEditar(false);
      return "Canal atualizado.";
    });
  }

  return (
    <li className={clsx("card p-4", !c.ativo && "opacity-70")} data-testid="canal">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{c.nome} <Badge cor={c.ativo ? "verde" : "cinza"}>{c.ativo ? "ativo" : "inativo"}</Badge> {c.status_conexao && <Badge cor={c.status_conexao === "open" ? "verde" : "amarelo"}>{c.status_conexao}</Badge>}</p>
          <p className="text-sm text-slate-600">{tipo.rotulo} · {c.municipio?.nome ?? "toda a organização"} · {c.conversas} conversa(s){c.ultimo_evento_em ? ` · último evento ${new Date(c.ultimo_evento_em).toLocaleString("pt-BR")}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(c.tipo === "WHATSAPP_EVOLUTION" || c.tipo === "WHATSAPP_ZAPI") && (
            <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => executar(async () => { const r = await api(`/api/v1/admin/canais/${c.id}`, "POST", { acao: "conectar" }); setQr(r.qrcode ?? null); return r.mensagem ?? (r.qrcode ? "Leia o QR Code no WhatsApp do órgão." : `Estado: ${r.estado}`); })}>
              {c.tipo === "WHATSAPP_EVOLUTION" ? "Criar instância / QR Code" : "Mostrar QR Code"}
            </button>
          )}
          {c.tipo !== "WEBCHAT" && c.tipo !== "EMAIL" && <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => executar(async () => { const r = await api(`/api/v1/admin/canais/${c.id}`, "POST", { acao: "status" }); return `Estado: ${r.estado}${r.detalhe ? ` (${r.detalhe})` : ""}`; })}>Status</button>}
          <button type="button" className="btn-secundario btn-sm" onClick={() => setEditar((v) => !v)}>Editar</button>
          <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => executar(async () => { await api(`/api/v1/admin/canais/${c.id}`, "PATCH", { ativo: !c.ativo }); return c.ativo ? "Canal desativado." : "Canal ativado."; })}>{c.ativo ? "Desativar" : "Ativar"}</button>
        </div>
      </div>

      {c.webhook_url && (
        <details className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Webhook e instruções</summary>
          <dl className="mt-2 space-y-2">
            <div><dt className="text-xs text-slate-500">URL do webhook {c.tipo === "WHATSAPP_EVOLUTION" ? "(o segredo vai no header x-webhook-secret)" : "(com token)"}</dt><dd className="break-all font-mono text-xs" data-testid="webhook-url">{c.tipo === "WHATSAPP_EVOLUTION" ? c.webhook_url_sem_token : c.webhook_url}</dd></div>
            <div><dt className="text-xs text-slate-500">Segredo do webhook</dt><dd className="break-all font-mono text-xs">{c.webhook_secret}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-600">{INSTRUCOES[c.tipo]}</p>
        </details>
      )}
      {!c.webhook_url && <p className="mt-2 text-xs text-slate-600">{INSTRUCOES[c.tipo]}</p>}

      {qr && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-md border border-slate-200 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code para conectar o WhatsApp" className="h-56 w-56" />
          <button type="button" className="btn-secundario btn-sm" onClick={() => setQr(null)}>Fechar QR Code</button>
        </div>
      )}

      {editar && (
        <form onSubmit={salvar} className="mt-3 grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2">
          <div><label htmlFor={`nome-${c.id}`} className="label">Nome</label><input id={`nome-${c.id}`} name="nome" className="input" defaultValue={c.nome} /></div>
          {c.tipo !== "WEBCHAT" && (
            <div>
              <label htmlFor={`mun-${c.id}`} className="label">Município</label>
              <select id={`mun-${c.id}`} name="municipio_id" className="input" defaultValue={c.municipio_id ?? ""}>
                <option value="">Toda a organização</option>
                {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>
          )}
          {tipo.campos.publicos.map((x) => (
            <div key={x.k}><label htmlFor={`p_${x.k}-${c.id}`} className="label">{x.rotulo}</label><input id={`p_${x.k}-${c.id}`} name={`p_${x.k}`} className="input" defaultValue={c.config[x.k] ?? ""} /></div>
          ))}
          {tipo.campos.segredos.map((x) => (
            <div key={x.k}><label htmlFor={`s_${x.k}-${c.id}`} className="label">{x.rotulo}</label><input id={`s_${x.k}-${c.id}`} name={`s_${x.k}`} type="password" autoComplete="off" className="input" placeholder={c.segredos_definidos.includes(x.k) ? "•••••• (manter)" : ""} /></div>
          ))}
          <div className="sm:col-span-2"><button className="btn-primario btn-sm" disabled={ocupado}>Salvar</button></div>
        </form>
      )}

      {c.tipo !== "WEBCHAT" && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void executar(async () => { const r = await api(`/api/v1/admin/canais/${c.id}`, "POST", { acao: "testar", destino }); return r.simulado ? "Envio simulado registrado no log (CANAIS_ENVIO_SIMULADO)." : "Mensagem de teste enviada."; }); }}>
          <div>
            <label htmlFor={`teste-${c.id}`} className="label">{c.tipo === "EMAIL" ? "E-mail para teste" : c.tipo === "WHATSAPP_CHATWOOT" ? "ID da conversa no Chatwoot" : "Telefone para teste"}</label>
            <input id={`teste-${c.id}`} className="input" value={destino} onChange={(e) => setDestino(e.target.value)} placeholder={c.tipo === "EMAIL" ? "voce@orgao.gov.br" : "(75) 99999-8888"} />
          </div>
          <button className="btn-secundario btn-sm" disabled={ocupado || destino.trim().length < 3}>Enviar mensagem de teste</button>
        </form>
      )}
      {msg && <div className="mt-3"><Aviso tipo={msg.t}>{msg.m}</Aviso></div>}
    </li>
  );
}
