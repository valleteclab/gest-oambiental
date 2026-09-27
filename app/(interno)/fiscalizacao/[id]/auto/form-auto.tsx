"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "@/components/ui";
import { erroDaResposta } from "@/lib/fiscalizacao/cliente";
import { ROTULO_PENALIDADE, lerMoeda } from "@/lib/fiscalizacao/regras";
import { SeletorPessoa, refPessoa, type PessoaSel, type ValorPessoa } from "../../_componentes/seletor-pessoa";

export function FormAuto({ fiscalizacaoId, sugestao, relato }: { fiscalizacaoId: string; sugestao: PessoaSel | null; relato: string }) {
  const router = useRouter();
  const [autuado, setAutuado] = useState<ValorPessoa>({ pessoa: null, nova: null });
  const [enquadramento, setEnquadramento] = useState("");
  const [descricao, setDescricao] = useState(relato);
  const [penalidade, setPenalidade] = useState("MULTA");
  const [valor, setValor] = useState("");
  const [prazo, setPrazo] = useState("20");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    const valorNum = lerMoeda(valor);
    if (valorNum !== null && Number.isNaN(valorNum)) return setErro("Valor da multa inválido.");
    if (!autuado.pessoa && !autuado.nova) return setErro("Selecione ou cadastre o autuado.");
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/autos-infracao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalizacao_id: fiscalizacaoId, autuado: refPessoa(autuado), enquadramento_legal: enquadramento, descricao_infracao: descricao, penalidade, valor_multa: valorNum, prazo_defesa_dias: Number(prazo) }),
      });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const j = await r.json();
      router.push(`/fiscalizacao/${fiscalizacaoId}?${j.erro_pdf ? `erro_pdf=${encodeURIComponent(j.erro_pdf)}` : "auto=" + encodeURIComponent(j.numero)}#auto-${j.id}`);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="card space-y-4 p-4 sm:p-6" noValidate data-testid="form-auto">
      <SeletorPessoa rotulo="Autuado" valor={autuado} onChange={setAutuado} sugestao={sugestao} />
      <div>
        <label htmlFor="enq" className="label">Enquadramento legal *</label>
        <textarea id="enq" className="input min-h-20" value={enquadramento} onChange={(e) => setEnquadramento(e.target.value)} placeholder="Ex.: Art. 60 da Lei Federal nº 9.605/1998; Art. 66 do Decreto nº 6.514/2008; Lei Municipal nº …" maxLength={2000} />
      </div>
      <div>
        <label htmlFor="desc" className="label">Descrição da infração *</label>
        <textarea id="desc" className="input min-h-32" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={10000} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="pen" className="label">Penalidade *</label>
          <select id="pen" className="input" value={penalidade} onChange={(e) => setPenalidade(e.target.value)}>
            {Object.entries(ROTULO_PENALIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="valor" className="label">Valor da multa (R$){penalidade === "MULTA" ? " *" : ""}</label>
          <input id="valor" className="input" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div>
          <label htmlFor="prazo" className="label">Prazo de defesa (dias) *</label>
          <input id="prazo" className="input" type="number" min={1} max={365} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button type="submit" className="btn-perigo w-full sm:w-auto" disabled={enviando} data-testid="lavrar-auto">{enviando ? "Lavrando…" : "Lavrar auto e gerar PDF"}</button>
    </form>
  );
}
