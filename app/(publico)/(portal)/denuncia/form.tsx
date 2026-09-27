"use client";
import { useEffect, useRef, useState } from "react";
import { Mapa } from "@/components/mapa";
import { Aviso } from "@/components/ui";
import { capturarPosicao, erroDaResposta, mensagemErroGeo } from "@/lib/fiscalizacao/cliente";

type Mun = { id: string; nome: string; lat: number | null; lng: number | null };

export function FormDenuncia({ municipios, municipioInicial = "" }: { municipios: Mun[]; municipioInicial?: string }) {
  const inicio = useRef(Date.now());
  const [municipioId, setMunicipioId] = useState(municipioInicial);
  const [descricao, setDescricao] = useState("");
  const [endereco, setEndereco] = useState("");
  const [anonima, setAnonima] = useState(true);
  const [nome, setNome] = useState("");
  const [contato, setContato] = useState("");
  const [website, setWebsite] = useState("");
  const [ponto, setPonto] = useState<[number, number] | null>(null);
  const [geo, setGeo] = useState<{ carregando: boolean; erro?: string; precisao?: number }>({ carregando: false });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [protocolo, setProtocolo] = useState<string | null>(null);
  const mun = municipios.find((m) => m.id === municipioId);
  const centro: [number, number] = ponto ?? (mun?.lat != null && mun?.lng != null ? [mun.lat, mun.lng] : [-12.45, -40.2]);
  const [chaveMapa, setChaveMapa] = useState(0);
  useEffect(() => setChaveMapa((k) => k + 1), [municipioId]);

  async function usarLocalizacao() {
    setGeo({ carregando: true });
    try {
      const p = await capturarPosicao();
      setPonto([p.latitude, p.longitude]);
      setGeo({ carregando: false, precisao: p.precisao });
      setChaveMapa((k) => k + 1);
    } catch (e) {
      setGeo({ carregando: false, erro: mensagemErroGeo(e as GeolocationPositionError) });
    }
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/public/denuncias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          municipio_id: municipioId, descricao, endereco, anonima, denunciante_nome: anonima ? null : nome, contato: anonima ? null : contato,
          latitude: ponto?.[0] ?? null, longitude: ponto?.[1] ?? null, website, tempo_ms: Date.now() - inicio.current,
        }),
      });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const j = await r.json();
      setProtocolo(j.protocolo);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (protocolo)
    return (
      <div className="card p-6 text-center" data-testid="denuncia-sucesso">
        <p className="text-sm text-slate-600">Denúncia registrada com sucesso. Seu número de protocolo é:</p>
        <p className="my-3 text-2xl font-bold tracking-wide text-primaria-800" data-testid="protocolo">{protocolo}</p>
        <p className="text-sm text-slate-600">Anote este número. A denúncia foi encaminhada à fiscalização ambiental do município.</p>
        <button type="button" className="btn-secundario mt-6" onClick={() => { setProtocolo(null); setDescricao(""); setEndereco(""); setPonto(null); inicio.current = Date.now(); }}>
          Registrar outra denúncia
        </button>
      </div>
    );

  return (
    <form onSubmit={enviar} className="card space-y-5 p-4 sm:p-6" noValidate>
      <div>
        <label htmlFor="municipio" className="label">Município *</label>
        <select id="municipio" className="input" required value={municipioId} onChange={(e) => setMunicipioId(e.target.value)}>
          <option value="">Selecione…</option>
          {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="descricao" className="label">O que está acontecendo? *</label>
        <textarea id="descricao" className="input min-h-32" required minLength={20} maxLength={5000} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva a situação, desde quando ocorre, quem pode estar envolvido…" />
        <span className="mt-1 block text-xs text-slate-500">{descricao.length}/5000 caracteres (mínimo 20)</span>
      </div>
      <div>
        <label htmlFor="endereco" className="label">Endereço ou ponto de referência *</label>
        <input id="endereco" className="input" required maxLength={300} value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, bairro, povoado, estrada…" />
      </div>

      <fieldset>
        <legend className="label">Local no mapa (opcional)</legend>
        <p className="mb-2 text-xs text-slate-500">Toque no mapa para marcar o local ou use a localização do seu celular.</p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secundario" onClick={usarLocalizacao} disabled={geo.carregando}>
            {geo.carregando ? "Obtendo localização…" : "Usar minha localização"}
          </button>
          {ponto && (
            <>
              <span className="text-xs text-slate-600" data-testid="coordenadas">{ponto[0].toFixed(6)}, {ponto[1].toFixed(6)}{geo.precisao ? ` (±${Math.round(geo.precisao)} m)` : ""}</span>
              <button type="button" className="btn-sm btn-secundario" onClick={() => setPonto(null)}>Limpar</button>
            </>
          )}
        </div>
        {geo.erro && <div className="mb-2"><Aviso tipo="alerta">{geo.erro}</Aviso></div>}
        <Mapa key={chaveMapa} centro={centro} zoom={ponto ? 16 : mun ? 13 : 8} altura="280px" selecionavel selecionado={ponto} onSelecionar={(lat, lng) => setPonto([lat, lng])} />
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Identificação</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={anonima} onChange={(e) => setAnonima(e.target.checked)} className="h-4 w-4" />
          Quero fazer a denúncia de forma anônima
        </label>
        {!anonima && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="nome" className="label">Seu nome *</label>
              <input id="nome" className="input" maxLength={150} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
            </div>
            <div>
              <label htmlFor="contato" className="label">Telefone ou e-mail</label>
              <input id="contato" className="input" maxLength={150} value={contato} onChange={(e) => setContato(e.target.value)} autoComplete="email" />
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">Seus dados são protegidos (criptografados) e não são divulgados. Uso exclusivo da fiscalização (LGPD).</p>
          </div>
        )}
      </fieldset>

      {/* honeypot anti-robô: invisível para pessoas */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="website">Não preencha este campo</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button type="submit" className="btn-primario w-full sm:w-auto" disabled={enviando}>{enviando ? "Enviando…" : "Enviar denúncia"}</button>
    </form>
  );
}
