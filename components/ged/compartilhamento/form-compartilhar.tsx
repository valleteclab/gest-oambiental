"use client";
// Criação do link público (OTP no WhatsApp). Chama POST /api/v1/ged/compartilhamentos e mostra o link UMA vez, com botão de copiar.
import Link from "next/link";
import { useState } from "react";
import { Aviso } from "@/components/ui";

type Props = {
  tipo: "documento" | "pasta";
  id: string;
  exigeConfirmacao: boolean;
  validadePadrao: number;
  validadeMax: number;
  notificarPadrao: boolean;
};
type Criado = { id: string; url: string; expira_em: string; destinatario_mascarado: string; link_whatsapp: string; pode_zip: boolean };

export function FormCompartilhar({ tipo, id, exigeConfirmacao, validadePadrao, validadeMax, notificarPadrao }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [criado, setCriado] = useState<Criado | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [baixar, setBaixar] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErro("");
    setEnviando(true);
    const f = new FormData(e.currentTarget);
    const marca = (k: string) => f.get(k) === "on";
    const texto = (k: string) => String(f.get(k) ?? "").trim();
    try {
      const r = await fetch("/api/v1/ged/compartilhamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recurso: { tipo, id },
          destinatario_nome: texto("destinatario_nome"),
          whatsapp: texto("whatsapp"),
          validade_dias: texto("validade_dias"),
          pode_visualizar: marca("pode_visualizar"),
          pode_baixar: marca("pode_baixar"),
          pode_zip: marca("pode_zip"),
          limite_downloads: texto("limite_downloads"),
          mensagem: texto("mensagem"),
          confirmar_restrito: marca("confirmar_restrito"),
          congelar: marca("congelar"),
          notificar_primeiro_acesso: marca("notificar_primeiro_acesso"),
          enviar_link_whatsapp: marca("enviar_link_whatsapp"),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const det = Array.isArray(j?.details) ? j.details[0]?.message : null;
        setErro(det ?? j?.message ?? "Não foi possível criar o link.");
        return;
      }
      setCriado(j as Criado);
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (criado) {
    return (
      <div className="space-y-4" data-testid="link-criado">
        <Aviso tipo="sucesso">Link criado. Ele só é exibido agora: copie e envie ao destinatário. O código de acesso será enviado ao WhatsApp {criado.destinatario_mascarado} quando ele abrir o link.</Aviso>
        <div>
          <label className="label" htmlFor="link-url">Link público</label>
          <div className="flex flex-wrap gap-2">
            <input id="link-url" readOnly className="input min-w-0 flex-1 font-mono text-xs" value={criado.url} onFocus={(e) => e.currentTarget.select()} data-testid="link-url" />
            <button
              type="button" className="btn-primario"
              onClick={async () => {
                try { await navigator.clipboard.writeText(criado.url); setCopiado(true); } catch { setCopiado(false); }
              }}
            >
              {copiado ? "Copiado" : "Copiar link"}
            </button>
          </div>
        </div>
        {criado.link_whatsapp === "ENVIADO" && <Aviso tipo="info">O link também foi enviado ao WhatsApp do destinatário.</Aviso>}
        {criado.link_whatsapp === "FALHOU" && <Aviso tipo="alerta">Não foi possível enviar o link por WhatsApp; envie você mesmo pelo link acima.</Aviso>}
        <p className="text-sm text-slate-600">Válido até {new Date(criado.expira_em).toLocaleDateString("pt-BR")}. Você pode acompanhar os acessos e revogar o link a qualquer momento.</p>
        <Link href={`/ged/compartilhamentos/${criado.id}`} prefetch={false} className="btn-secundario">Ver acompanhamento</Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4" aria-label="Compartilhar por link" data-testid="form-compartilhar">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cp-nome">Nome do destinatário (opcional)</label>
          <input id="cp-nome" name="destinatario_nome" className="input" maxLength={120} autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="cp-whatsapp">WhatsApp do destinatário *</label>
          <input id="cp-whatsapp" name="whatsapp" className="input" inputMode="tel" placeholder="(75) 99999-8888" required maxLength={30} autoComplete="off" />
          <span className="mt-1 block text-xs text-slate-500">O código de acesso será enviado a este número. O destinatário não digita número nenhum.</span>
        </div>
        <div>
          <label className="label" htmlFor="cp-validade">Validade (dias)</label>
          <input id="cp-validade" name="validade_dias" type="number" min={1} max={validadeMax} defaultValue={validadePadrao} className="input" />
          <span className="mt-1 block text-xs text-slate-500">Máximo de {validadeMax} dia(s).</span>
        </div>
        <div>
          <label className="label" htmlFor="cp-limite">Limite de downloads (opcional)</label>
          <input id="cp-limite" name="limite_downloads" type="number" min={1} max={10000} className="input" placeholder="Sem limite" />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="label">O que o destinatário pode fazer</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pode_visualizar" defaultChecked /> Visualizar no navegador</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pode_baixar" checked={baixar} onChange={(e) => setBaixar(e.target.checked)} /> Baixar os arquivos</label>
        {tipo === "pasta" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pode_zip" disabled={!baixar} /> Baixar a pasta inteira em ZIP</label>}
      </fieldset>
      <div>
        <label className="label" htmlFor="cp-msg">Mensagem para o destinatário (opcional)</label>
        <textarea id="cp-msg" name="mensagem" className="input" rows={2} maxLength={500} />
        <span className="mt-1 block text-xs text-slate-500">Aparece só depois que ele confirmar o código.</span>
      </div>
      {tipo === "pasta" && (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="congelar" className="mt-1" /> <span><strong>Congelar a lista agora:</strong> só os documentos que existem hoje na pasta ficam no link (sem isso, documentos novos entram no link).</span></label>
      )}
      {exigeConfirmacao && (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><input type="checkbox" name="confirmar_restrito" className="mt-1" data-testid="confirmar-restrito" /> <span><strong>Confirmo</strong> que o conteúdo é de acesso restrito e que desejo compartilhá-lo com esta pessoa fora da organização.</span></label>
      )}
      <fieldset className="space-y-2">
        <legend className="label">Avisos</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notificar_primeiro_acesso" defaultChecked={notificarPadrao} /> Avisar-me por e-mail no primeiro acesso</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enviar_link_whatsapp" /> Enviar também o link ao WhatsApp do destinatário (sem o código)</label>
      </fieldset>
      {erro && <div role="alert" data-testid="compartilhar-erro"><Aviso tipo="erro">{erro}</Aviso></div>}
      <button className="btn-primario" disabled={enviando} data-testid="criar-link">{enviando ? "Criando…" : "Criar link"}</button>
    </form>
  );
}
