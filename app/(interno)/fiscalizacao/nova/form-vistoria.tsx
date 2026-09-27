"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Mapa } from "@/components/mapa";
import { Aviso } from "@/components/ui";
import { capturarPosicao, comprimirFoto, erroDaResposta, fmtBytes, mensagemErroGeo } from "@/lib/fiscalizacao/cliente";
import { MAX_FOTOS } from "@/lib/fiscalizacao/regras";
import { acaoBuscarEmpreendimentos } from "../actions";

type Mun = { id: string; nome: string; sigla: string; latitude: number | null; longitude: number | null };
type Membro = { id: string; nome: string; cargo: string | null };
type Emp = { id: string; nome: string; municipio_id: string; latitude: number | null; longitude: number | null };
export type ContextoVistoria = {
  denuncia?: { id: string; protocolo: string; descricao: string; endereco: string | null; latitude: number | null; longitude: number | null; municipio_id: string } | null;
  processo?: { id: string; numero: string | null; status: string; municipio_id: string; empreendimento: Emp } | null;
  empreendimento?: Emp | null;
};

type Foto = { chave: string; arquivo: File; url: string; original: number; recomprimida: boolean; latitude: number | null; longitude: number | null };
type Pos = { latitude: number; longitude: number; precisao: number | null; manual: boolean };

const agoraLocal = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function corPrecisao(m: number | null) {
  if (m === null) return "text-slate-700";
  if (m <= 20) return "text-emerald-700";
  if (m <= 100) return "text-amber-700";
  return "text-red-700";
}

export function FormVistoria({ usuario, municipios, equipePorMunicipio, contexto }: { usuario: { id: string; nome: string }; municipios: Mun[]; equipePorMunicipio: Record<string, Membro[]>; contexto: ContextoVistoria }) {
  const router = useRouter();
  const municipioContexto = contexto.denuncia?.municipio_id ?? contexto.processo?.municipio_id ?? contexto.empreendimento?.municipio_id ?? null;
  const [municipioId, setMunicipioId] = useState<string>(municipioContexto ?? (municipios.length === 1 ? municipios[0].id : ""));
  const [pos, setPos] = useState<Pos | null>(null);
  const [geo, setGeo] = useState<{ carregando: boolean; erro?: string }>({ carregando: false });
  const [mapaManual, setMapaManual] = useState(false);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [processandoFotos, setProcessandoFotos] = useState(0);
  const [erroFotos, setErroFotos] = useState<string | null>(null);
  const [constatacao, setConstatacao] = useState<"" | "IRREGULAR" | "REGULAR" | "INCONCLUSIVA">("");
  const [relato, setRelato] = useState("");
  const [dataHora, setDataHora] = useState("");
  const [equipe, setEquipe] = useState<string[]>([]);
  const [outroMembro, setOutroMembro] = useState("");
  const [empreendimento, setEmpreendimento] = useState<Emp | null>(contexto.processo?.empreendimento ?? contexto.empreendimento ?? null);
  const [buscaEmp, setBuscaEmp] = useState("");
  const [resultadosEmp, setResultadosEmp] = useState<Emp[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);

  useEffect(() => setDataHora(agoraLocal()), []);
  useEffect(() => () => fotos.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (contexto.processo || contexto.empreendimento || buscaEmp.trim().length < 2) {
      setResultadosEmp([]);
      return;
    }
    const t = setTimeout(async () => setResultadosEmp(await acaoBuscarEmpreendimentos(buscaEmp, municipioId || null)), 300);
    return () => clearTimeout(t);
  }, [buscaEmp, municipioId, contexto.processo, contexto.empreendimento]);

  const mun = municipios.find((m) => m.id === municipioId);
  const referencia: [number, number] | null =
    contexto.denuncia?.latitude != null && contexto.denuncia.longitude != null ? [contexto.denuncia.latitude, contexto.denuncia.longitude]
      : empreendimento?.latitude != null && empreendimento.longitude != null ? [empreendimento.latitude, empreendimento.longitude]
        : mun?.latitude != null && mun.longitude != null ? [mun.latitude, mun.longitude] : null;

  async function capturar() {
    setGeo({ carregando: true });
    try {
      const p = await capturarPosicao();
      setPos({ latitude: p.latitude, longitude: p.longitude, precisao: p.precisao, manual: false });
      setGeo({ carregando: false });
    } catch (e) {
      setGeo({ carregando: false, erro: mensagemErroGeo(e as GeolocationPositionError) });
      setMapaManual(true);
    }
  }

  async function adicionarFotos(lista: FileList | null) {
    if (!lista?.length) return;
    setErroFotos(null);
    const arquivos = Array.from(lista).slice(0, Math.max(0, MAX_FOTOS - fotos.length));
    if (arquivos.length < lista.length) setErroFotos(`Máximo de ${MAX_FOTOS} fotos por vistoria.`);
    setProcessandoFotos((n) => n + arquivos.length);
    for (const a of arquivos) {
      try {
        if (!a.type.startsWith("image/")) throw new Error(`"${a.name}" não é uma imagem.`);
        const r = await comprimirFoto(a);
        setFotos((fs) => [...fs, { chave: `${Date.now()}-${Math.random()}`, arquivo: r.arquivo, url: URL.createObjectURL(r.arquivo), original: r.original.tamanho, recomprimida: r.recomprimida, latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null }]);
      } catch (e) {
        setErroFotos((e as Error).message);
      } finally {
        setProcessandoFotos((n) => n - 1);
      }
    }
    if (inputFoto.current) inputFoto.current.value = "";
  }

  function removerFoto(chave: string) {
    setFotos((fs) => {
      const f = fs.find((x) => x.chave === chave);
      if (f) URL.revokeObjectURL(f.url);
      return fs.filter((x) => x.chave !== chave);
    });
  }

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    const faltando = [!municipioId && "município", !pos && "localização", !constatacao && "constatação", relato.trim().length < 10 && "relato (mín. 10 caracteres)", !dataHora && "data/hora"].filter(Boolean);
    if (faltando.length) {
      setErro(`Preencha: ${faltando.join(", ")}.`);
      return;
    }
    if (processandoFotos > 0) {
      setErro("Aguarde o processamento das fotos.");
      return;
    }
    const membros: { usuario_id: string | null; nome: string }[] = (equipePorMunicipio[municipioId] ?? []).filter((m) => equipe.includes(m.id)).map((m) => ({ usuario_id: m.id, nome: m.nome }));
    if (outroMembro.trim()) membros.push({ usuario_id: null, nome: outroMembro.trim() });
    const dados = {
      municipio_id: municipioId, denuncia_id: contexto.denuncia?.id ?? null, processo_id: contexto.processo?.id ?? null, empreendimento_id: empreendimento?.id ?? null,
      data_hora: new Date(dataHora).toISOString(), latitude: pos!.latitude, longitude: pos!.longitude, precisao_m: pos!.precisao,
      equipe: membros, relato, constatacao,
    };
    const fd = new FormData();
    fd.set("dados", JSON.stringify(dados));
    fd.set("fotos_meta", JSON.stringify(fotos.map((f) => ({ latitude: f.latitude, longitude: f.longitude }))));
    fotos.forEach((f) => fd.append("fotos", f.arquivo, f.arquivo.name));
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/fiscalizacoes", { method: "POST", body: fd });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const j = await r.json();
      router.push(`/fiscalizacao/${j.id}?criada=1`);
    } catch (e) {
      setErro((e as Error).message || "Falha ao salvar. Verifique a conexão e tente novamente.");
      setEnviando(false);
    }
  }

  const membrosDisponiveis = (equipePorMunicipio[municipioId] ?? []).filter((m) => m.id !== usuario.id);

  return (
    <form onSubmit={salvar} className="space-y-4 pb-24" noValidate data-testid="form-vistoria">
      {contexto.denuncia && (
        <Aviso tipo="info"><strong>Denúncia {contexto.denuncia.protocolo}</strong>: <span className="line-clamp-3">{contexto.denuncia.descricao}</span>{contexto.denuncia.endereco && <span className="block text-xs">Local: {contexto.denuncia.endereco}</span>}</Aviso>
      )}
      {contexto.processo && <Aviso tipo="info"><strong>Processo {contexto.processo.numero ?? "—"}</strong> · {contexto.processo.empreendimento.nome}</Aviso>}

      {!municipioContexto && municipios.length > 1 && (
        <section className="card p-4">
          <label htmlFor="municipio" className="label">Município *</label>
          <select id="municipio" className="input" value={municipioId} onChange={(e) => { setMunicipioId(e.target.value); setEquipe([]); }}>
            <option value="">Selecione…</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </section>
      )}

      {/* 1. Localização */}
      <section className="card p-4" aria-labelledby="t-loc">
        <h2 id="t-loc" className="mb-3 text-base font-semibold">1. Localização *</h2>
        <button type="button" onClick={capturar} disabled={geo.carregando} className="btn-primario w-full py-4 text-base" data-testid="capturar-localizacao">
          {geo.carregando ? "Obtendo sinal de GPS…" : pos && !pos.manual ? "Capturar novamente" : "📍 Capturar localização"}
        </button>
        {pos && (
          <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm" data-testid="posicao">
            <div className="font-mono">{pos.latitude.toFixed(6)}, {pos.longitude.toFixed(6)}</div>
            {pos.manual ? <div className="text-slate-600">Marcado manualmente no mapa</div>
              : <div className={clsx("font-medium", corPrecisao(pos.precisao))} data-testid="precisao">Precisão: ±{pos.precisao !== null ? Math.round(pos.precisao) : "?"} m{pos.precisao !== null && pos.precisao > 100 ? " – baixa, tente novamente em área aberta" : ""}</div>}
          </div>
        )}
        {geo.erro && <div className="mt-3"><Aviso tipo="alerta">{geo.erro}</Aviso></div>}
        <button type="button" className="mt-3 text-sm text-primaria-700 underline" onClick={() => setMapaManual((v) => !v)}>
          {mapaManual ? "Ocultar mapa" : "Marcar/ajustar no mapa"}
        </button>
        {mapaManual && (
          <div className="mt-2">
            <p className="mb-1 text-xs text-slate-500">Toque no mapa para marcar o ponto da vistoria.</p>
            <Mapa centro={pos ? [pos.latitude, pos.longitude] : referencia ?? undefined} zoom={pos || referencia ? 15 : 8} altura="260px" selecionavel selecionado={pos ? [pos.latitude, pos.longitude] : null}
              onSelecionar={(lat, lng) => setPos({ latitude: lat, longitude: lng, precisao: null, manual: true })} />
          </div>
        )}
      </section>

      {/* 2. Fotos */}
      <section className="card p-4" aria-labelledby="t-fotos">
        <h2 id="t-fotos" className="mb-3 text-base font-semibold">2. Fotos</h2>
        <label className="btn-secundario w-full cursor-pointer py-4 text-base">
          📷 Tirar / escolher fotos
          <input ref={inputFoto} type="file" accept="image/*" capture="environment" multiple className="sr-only" data-testid="input-fotos" onChange={(e) => adicionarFotos(e.target.files)} />
        </label>
        <p className="mt-1 text-xs text-slate-500">Fotos acima de 1,5 MB são reduzidas no aparelho (os metadados EXIF são preservados apenas quando a foto não precisa ser reduzida).</p>
        {processandoFotos > 0 && <p className="mt-2 text-sm text-slate-600" role="status">Processando {processandoFotos} foto(s)…</p>}
        {erroFotos && <div className="mt-2"><Aviso tipo="alerta">{erroFotos}</Aviso></div>}
        {fotos.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="miniaturas">
            {fotos.map((f, i) => (
              <li key={f.chave} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={`Foto ${i + 1}`} className="aspect-square w-full rounded-md border border-slate-200 object-cover" />
                <button type="button" onClick={() => removerFoto(f.chave)} aria-label={`Remover foto ${i + 1}`} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-white">✕</button>
                <span className="block truncate text-[10px] text-slate-500">{fmtBytes(f.arquivo.size)}{f.recomprimida ? ` (de ${fmtBytes(f.original)})` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Constatação e relato */}
      <section className="card space-y-4 p-4" aria-labelledby="t-const">
        <h2 id="t-const" className="text-base font-semibold">3. Constatação e relato</h2>
        <fieldset>
          <legend className="label">Constatação *</legend>
          <div className="grid grid-cols-3 gap-2">
            {([["IRREGULAR", "Irregular", "border-red-600 bg-red-50 text-red-800"], ["REGULAR", "Regular", "border-emerald-600 bg-emerald-50 text-emerald-800"], ["INCONCLUSIVA", "Inconclusiva", "border-amber-500 bg-amber-50 text-amber-800"]] as const).map(([v, r, cor]) => (
              <label key={v} className={clsx("flex cursor-pointer items-center justify-center rounded-md border-2 px-2 py-3 text-center text-sm font-medium", constatacao === v ? cor : "border-slate-200 bg-white text-slate-700")}>
                <input type="radio" name="constatacao" value={v} checked={constatacao === v} onChange={() => setConstatacao(v)} className="sr-only" />
                {r}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="relato" className="label">Relato da vistoria *</label>
          <textarea id="relato" className="input min-h-36" value={relato} onChange={(e) => setRelato(e.target.value)} maxLength={20000} placeholder="O que foi observado no local, pessoas presentes, medidas adotadas…" />
        </div>
        <div>
          <label htmlFor="data_hora" className="label">Data e hora *</label>
          <input id="data_hora" type="datetime-local" className="input" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
        </div>
      </section>

      {/* 4. Vínculos e equipe */}
      <section className="card space-y-4 p-4" aria-labelledby="t-vinc">
        <h2 id="t-vinc" className="text-base font-semibold">4. Empreendimento e equipe</h2>
        <div>
          <span className="label">Empreendimento vistoriado</span>
          {empreendimento ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span>{empreendimento.nome}</span>
              {!contexto.processo && !contexto.empreendimento && <button type="button" className="btn-sm btn-secundario" onClick={() => setEmpreendimento(null)}>Trocar</button>}
            </div>
          ) : (
            <div className="relative">
              <input className="input" aria-label="Buscar empreendimento" placeholder="Buscar por nome (opcional)" value={buscaEmp} onChange={(e) => setBuscaEmp(e.target.value)} />
              {resultadosEmp.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow">
                  {resultadosEmp.map((e) => (
                    <li key={e.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { setEmpreendimento(e); setBuscaEmp(""); if (!municipioId) setMunicipioId(e.municipio_id); }}>{e.nome}</button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <fieldset>
          <legend className="label">Equipe</legend>
          <p className="text-sm text-slate-700">✔ {usuario.nome} (você)</p>
          {membrosDisponiveis.map((m) => (
            <label key={m.id} className="mt-1 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={equipe.includes(m.id)} onChange={(e) => setEquipe((l) => (e.target.checked ? [...l, m.id] : l.filter((x) => x !== m.id)))} />
              {m.nome}{m.cargo ? <span className="text-xs text-slate-500"> · {m.cargo}</span> : null}
            </label>
          ))}
          <input className="input mt-2" aria-label="Outro membro da equipe" placeholder="Outro participante (nome, órgão)" value={outroMembro} onChange={(e) => setOutroMembro(e.target.value)} maxLength={150} />
        </fieldset>
      </section>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <button type="submit" className="btn-primario w-full py-3 text-base lg:w-auto" disabled={enviando || processandoFotos > 0} data-testid="salvar-vistoria">
          {enviando ? "Enviando…" : `Salvar vistoria${fotos.length ? ` (${fotos.length} foto${fotos.length > 1 ? "s" : ""})` : ""}`}
        </button>
      </div>
    </form>
  );
}
