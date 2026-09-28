"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EstadoConversa } from "@prisma/client";
import { Aviso } from "@/components/ui";
import { erroDaResposta } from "@/lib/fiscalizacao/cliente";

export function AcoesConversa({ id, estado, podeAtender, temDenuncia, pausada, dados }: { id: string; estado: EstadoConversa; podeAtender: boolean; temDenuncia: boolean; pausada: string | null; dados: { descricao: string; endereco: string } }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [manual, setManual] = useState(false);
  const [descricao, setDescricao] = useState(dados.descricao);
  const [endereco, setEndereco] = useState(dados.endereco);

  async function acao(corpo: Record<string, unknown>, sucesso: string) {
    setErro(null);
    setOk(null);
    setOcupado(true);
    try {
      const r = await fetch(`/api/v1/atendimento/conversas/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const j = await r.json();
      setOk(j.denuncia?.protocolo ? `${sucesso} Protocolo ${j.denuncia.protocolo}.` : j.mensagem?.status_envio === "ERRO" ? `Mensagem registrada, mas o envio falhou: ${j.mensagem.erro}` : sucesso);
      if (corpo.acao === "responder") setTexto("");
      if (corpo.acao === "criar_denuncia") setManual(false);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!podeAtender) return <p className="mt-3 text-xs text-slate-500">Somente leitura.</p>;
  const encerrada = estado === "ENCERRADA";
  return (
    <div className="mt-4 space-y-3">
      {pausada && <p className="text-xs text-violet-700">{pausada}</p>}
      <div className="flex flex-wrap gap-2">
        {estado !== "HUMANO" && !encerrada && <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => acao({ acao: "assumir" }, "Atendimento assumido – IA pausada por 3 h.")} data-testid="assumir">Assumir atendimento</button>}
        {estado === "HUMANO" && <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => acao({ acao: "devolver" }, "Conversa devolvida para a IA.")} data-testid="devolver">Devolver para IA</button>}
        {!temDenuncia && <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => setManual((v) => !v)} data-testid="criar-manual">Criar denúncia manualmente</button>}
        {!encerrada && <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => confirm("Encerrar esta conversa?") && acao({ acao: "encerrar" }, "Conversa encerrada.")}>Encerrar</button>}
      </div>
      {manual && (
        <form className="space-y-2 rounded-md border border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); void acao({ acao: "criar_denuncia", descricao, endereco }, "Denúncia registrada."); }}>
          <div>
            <label htmlFor="md-descricao" className="label">Descrição</label>
            <textarea id="md-descricao" className="input min-h-20" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={5000} />
          </div>
          <div>
            <label htmlFor="md-endereco" className="label">Endereço / referência</label>
            <input id="md-endereco" className="input" value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={300} />
          </div>
          <button className="btn-primario btn-sm" disabled={ocupado}>Registrar denúncia</button>
        </form>
      )}
      {!encerrada && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) void acao({ acao: "responder", texto }, "Mensagem enviada."); }}>
          <div className="flex-1">
            <label htmlFor="resposta" className="label">Responder como atendente</label>
            <textarea id="resposta" className="input min-h-[42px]" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000} placeholder="A IA fica pausada enquanto você atende." data-testid="resposta-atendente" />
          </div>
          <button className="btn-primario" disabled={ocupado || !texto.trim()} data-testid="enviar-resposta">Enviar</button>
        </form>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ok && <Aviso tipo="sucesso">{ok}</Aviso>}
    </div>
  );
}
