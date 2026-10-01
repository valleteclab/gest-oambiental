"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StatusDenuncia } from "@prisma/client";
import { Aviso } from "@/components/ui";
import { erroDaResposta } from "@/lib/fiscalizacao/cliente";
import { ROTULO_STATUS_DENUNCIA, TRANSICOES_DENUNCIA } from "@/lib/fiscalizacao/regras";

export function FormStatusDenuncia({ id, status }: { id: string; status: StatusDenuncia }) {
  const router = useRouter();
  const opcoes = TRANSICOES_DENUNCIA[status];
  const [novo, setNovo] = useState<StatusDenuncia>(opcoes[0]);
  const [despacho, setDespacho] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (!opcoes.length) return null;
  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await fetch(`/api/v1/denuncias/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: novo, despacho }) });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      setDespacho("");
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <form onSubmit={enviar} className="space-y-3">
      <div>
        <label htmlFor="novo-status" className="label">Nova situação</label>
        <select id="novo-status" className="input" value={novo} onChange={(e) => setNovo(e.target.value as StatusDenuncia)}>
          {opcoes.map((o) => <option key={o} value={o}>{ROTULO_STATUS_DENUNCIA[o]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="despacho" className="label">Despacho *</label>
        <textarea id="despacho" className="input min-h-20" value={despacho} onChange={(e) => setDespacho(e.target.value)} maxLength={3000} required />
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button className="btn-primario" disabled={enviando}>{enviando ? "Salvando…" : "Alterar situação"}</button>
    </form>
  );
}
