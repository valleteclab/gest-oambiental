"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mapa } from "@/components/mapa";
import { Aviso } from "@/components/ui";
import { erroDaResposta } from "@/lib/fiscalizacao/cliente";

type Mun = { id: string; nome: string; latitude: number | null; longitude: number | null };

export function FormDenunciaInterna({ municipios }: { municipios: Mun[] }) {
  const router = useRouter();
  const [municipioId, setMunicipioId] = useState(municipios.length === 1 ? municipios[0].id : "");
  const [canal, setCanal] = useState("PRESENCIAL");
  const [descricao, setDescricao] = useState("");
  const [endereco, setEndereco] = useState("");
  const [anonima, setAnonima] = useState(true);
  const [nome, setNome] = useState("");
  const [contato, setContato] = useState("");
  const [ponto, setPonto] = useState<[number, number] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const mun = municipios.find((m) => m.id === municipioId);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/denuncias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ municipio_id: municipioId, canal, descricao, endereco: endereco || null, anonima, denunciante_nome: anonima ? null : nome, contato: anonima ? null : contato, latitude: ponto?.[0] ?? null, longitude: ponto?.[1] ?? null }),
      });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const j = await r.json();
      router.push(`/fiscalizacao/denuncias/${j.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="card space-y-4 p-4 sm:p-6" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="municipio" className="label">Município *</label>
          <select id="municipio" className="input" value={municipioId} onChange={(e) => setMunicipioId(e.target.value)}>
            <option value="">Selecione…</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="canal" className="label">Canal *</label>
          <select id="canal" className="input" value={canal} onChange={(e) => setCanal(e.target.value)}>
            <option value="PRESENCIAL">Presencial</option>
            <option value="TELEFONE">Telefone</option>
            <option value="OUTRO">Outro</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="descricao" className="label">Descrição *</label>
        <textarea id="descricao" className="input min-h-28" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={5000} />
      </div>
      <div>
        <label htmlFor="endereco" className="label">Endereço / referência</label>
        <input id="endereco" className="input" value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={300} />
      </div>
      <div>
        <span className="label">Local no mapa (opcional)</span>
        <Mapa key={municipioId} centro={ponto ?? (mun?.latitude != null && mun.longitude != null ? [mun.latitude, mun.longitude] : undefined)} zoom={mun ? 13 : 8} altura="260px" selecionavel selecionado={ponto} onSelecionar={(lat, lng) => setPonto([lat, lng])} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={anonima} onChange={(e) => setAnonima(e.target.checked)} /> Denunciante não quis se identificar</label>
      {!anonima && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="nome" className="label">Nome do denunciante</label><input id="nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} /></div>
          <div><label htmlFor="contato" className="label">Contato (telefone/e-mail)</label><input id="contato" className="input" value={contato} onChange={(e) => setContato(e.target.value)} maxLength={150} /></div>
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button className="btn-primario" disabled={enviando}>{enviando ? "Salvando…" : "Registrar denúncia"}</button>
    </form>
  );
}
