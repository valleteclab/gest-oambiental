"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "@/components/ui";
import { erroDaResposta } from "@/lib/fiscalizacao/cliente";
import { prazoAteNotificacao } from "@/lib/fiscalizacao/regras";
import { SeletorPessoa, refPessoa, type PessoaSel, type ValorPessoa } from "../../_componentes/seletor-pessoa";

export function FormNotificacao({ fiscalizacaoId, sugestao }: { fiscalizacaoId: string; sugestao: PessoaSel | null }) {
  const router = useRouter();
  const [notificado, setNotificado] = useState<ValorPessoa>({ pessoa: null, nova: null });
  const [exigencia, setExigencia] = useState("");
  const [prazo, setPrazo] = useState("30");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const dias = Number(prazo);
  const ate = Number.isInteger(dias) && dias > 0 ? prazoAteNotificacao(dias).toLocaleDateString("pt-BR") : "—";

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (!notificado.pessoa && !notificado.nova) return setErro("Selecione ou cadastre o notificado.");
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/notificacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalizacao_id: fiscalizacaoId, notificado: refPessoa(notificado), exigencia, prazo_dias: dias }),
      });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const j = await r.json();
      router.push(`/fiscalizacao/${fiscalizacaoId}?${j.erro_pdf ? `erro_pdf=${encodeURIComponent(j.erro_pdf)}` : "notificacao=" + encodeURIComponent(j.numero)}#notificacao-${j.id}`);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="card space-y-4 p-4 sm:p-6" noValidate data-testid="form-notificacao">
      <SeletorPessoa rotulo="Notificado" valor={notificado} onChange={setNotificado} sugestao={sugestao} />
      <div>
        <label htmlFor="exig" className="label">Exigência *</label>
        <textarea id="exig" className="input min-h-32" value={exigencia} onChange={(e) => setExigencia(e.target.value)} maxLength={10000} placeholder="Ex.: Apresentar licença ambiental de operação; cessar o lançamento de efluentes…" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="prazo" className="label">Prazo para atendimento (dias) *</label>
          <input id="prazo" className="input" type="number" min={1} max={365} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </div>
        <div><span className="label">Prazo final</span><p className="py-2 text-sm" data-testid="prazo-ate">{ate}</p></div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button type="submit" className="btn-primario w-full sm:w-auto" disabled={enviando} data-testid="emitir-notificacao">{enviando ? "Emitindo…" : "Emitir notificação e gerar PDF"}</button>
    </form>
  );
}
