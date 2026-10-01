"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Camera, Loader2, LocateFixed, MapPin, MessageCircle, RotateCcw, Send, X } from "lucide-react";
import { Mapa } from "@/components/mapa";
import { capturarPosicao, comprimirFoto, erroDaResposta, mensagemErroGeo } from "@/lib/fiscalizacao/cliente";

// Chat do site com o Assistente Ambiental (mesmo agente do WhatsApp). Sessão em cookie httpOnly; respostas por polling.

type Botao = { id: string; rotulo: string };
type Msg = { id: string; direcao: "IN" | "OUT"; autor: string; tipo: string; texto: string | null; botoes: Botao[] | null; midia: boolean; local: boolean; created_at: string };
export type MunicipioChat = { sigla: string; nome: string; lat: number | null; lng: number | null };

/** *negrito*, _itálico_ e links do estilo WhatsApp → elementos React (sem HTML cru). */
export function TextoWhats({ texto }: { texto: string }) {
  const linhas = texto.split("\n");
  return (
    <>
      {linhas.map((l, i) => (
        <Fragment key={i}>
          {l.split(/(\*[^*\n]+\*|https?:\/\/[^\s]+)/g).map((p, j) =>
            p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <strong key={j}>{p.slice(1, -1)}</strong>
            : /^https?:\/\//.test(p) ? <a key={j} href={p} className="break-all underline" target="_blank" rel="noreferrer">{p}</a>
            : <Fragment key={j}>{p}</Fragment>,
          )}
          {i < linhas.length - 1 && <br />}
        </Fragment>
      ))}
    </>
  );
}

export function ChatDenuncia({ municipio, flutuante = false, aoPreferirFormulario }: { municipio: MunicipioChat; flutuante?: boolean; aoPreferirFormulario?: () => void }) {
  const [aberto, setAberto] = useState(!flutuante);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [estado, setEstado] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mapa, setMapa] = useState(false);
  const [ponto, setPonto] = useState<[number, number] | null>(null);
  const [website, setWebsite] = useState("");
  const lista = useRef<HTMLDivElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const qs = `municipio=${encodeURIComponent(municipio.sigla)}`;

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/v1/public/chat/mensagens?${qs}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setMsgs(j.mensagens ?? []);
      setEstado(j.estado ?? null);
    } catch {
      /* rede instável: tenta no próximo ciclo */
    }
  }, [qs]);

  useEffect(() => {
    if (!aberto) return;
    void carregar();
    const t = setInterval(() => void carregar(), 5000);
    return () => clearInterval(t);
  }, [aberto, carregar]);

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, enviando]);

  async function enviar(corpo: { texto?: string; botao?: string; latitude?: number; longitude?: number; foto?: File }) {
    setErro(null);
    setEnviando(true);
    // eco otimista da mensagem do cidadão
    const provisoria: Msg = { id: `tmp-${Date.now()}`, direcao: "IN", autor: "CIDADAO", tipo: corpo.foto ? "IMAGEM" : corpo.latitude != null ? "LOCALIZACAO" : "TEXTO", texto: corpo.texto ?? null, botoes: null, midia: false, local: corpo.latitude != null, created_at: new Date().toISOString() };
    setMsgs((m) => [...m, provisoria]);
    try {
      const fd = new FormData();
      fd.append("municipio", municipio.sigla);
      fd.append("cliente_id", crypto.randomUUID());
      fd.append("website", website);
      if (corpo.texto) fd.append("texto", corpo.texto);
      if (corpo.botao) fd.append("botao", corpo.botao);
      if (corpo.latitude != null && corpo.longitude != null) {
        fd.append("latitude", String(corpo.latitude));
        fd.append("longitude", String(corpo.longitude));
      }
      if (corpo.foto) fd.append("foto", corpo.foto);
      const r = await fetch("/api/v1/public/chat/mensagens", { method: "POST", body: fd });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const j = await r.json();
      setMsgs(j.mensagens ?? []);
      setEstado(j.estado ?? null);
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== provisoria.id));
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function enviarTexto(ev?: React.FormEvent) {
    ev?.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto("");
    await enviar({ texto: t });
  }

  async function enviarLocalizacao() {
    setErro(null);
    try {
      const p = await capturarPosicao();
      await enviar({ latitude: p.latitude, longitude: p.longitude, texto: "📍 Minha localização" });
    } catch (e) {
      setErro(mensagemErroGeo(e as GeolocationPositionError));
      setMapa(true);
    }
  }

  async function enviarFoto(f: File | undefined) {
    if (!f) return;
    try {
      const p = await comprimirFoto(f);
      await enviar({ foto: p.arquivo });
    } catch (e) {
      setErro((e as Error).message || "Não foi possível ler a foto.");
    } finally {
      if (arquivo.current) arquivo.current.value = "";
    }
  }

  async function novaConversa() {
    await fetch(`/api/v1/public/chat/mensagens?${qs}`, { method: "DELETE" }).catch(() => {});
    setMsgs([]);
    setEstado(null);
    setPonto(null);
    setMapa(false);
  }

  const ultimaBot = [...msgs].reverse().find((m) => m.direcao === "OUT");
  const botoes = ultimaBot && msgs[msgs.length - 1]?.id === ultimaBot.id ? ultimaBot.botoes ?? [] : [];
  const encerrada = estado === "ENCERRADA";
  const centro: [number, number] = ponto ?? (municipio.lat != null && municipio.lng != null ? [municipio.lat, municipio.lng] : [-12.45, -40.2]);

  if (flutuante && !aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} data-testid="chat-abrir" className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primaria-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-primaria-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primaria-700">
        <MessageCircle className="h-5 w-5" aria-hidden /> Denúncia pelo chat
      </button>
    );

  return (
    <section
      aria-label={`Chat com o Assistente Ambiental de ${municipio.nome}`}
      data-testid="chat-denuncia"
      className={clsx("flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm", flutuante ? "fixed inset-x-2 bottom-2 z-40 h-[85vh] max-h-[640px] sm:inset-x-auto sm:right-4 sm:w-[400px] sm:shadow-xl" : "h-[620px] max-h-[80vh]")}
    >
      <header className="flex items-center gap-3 bg-primaria-800 px-4 py-3 text-white">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-lg" aria-hidden>🌿</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Assistente Ambiental</p>
          <p className="truncate text-xs text-emerald-100">Secretaria de Meio Ambiente · {municipio.nome}</p>
        </div>
        <button type="button" onClick={novaConversa} className="rounded p-1.5 hover:bg-white/10" title="Nova conversa" aria-label="Nova conversa"><RotateCcw className="h-4 w-4" /></button>
        {flutuante && <button type="button" onClick={() => setAberto(false)} className="rounded p-1.5 hover:bg-white/10" aria-label="Fechar chat"><X className="h-4 w-4" /></button>}
      </header>

      <div ref={lista} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-4" data-testid="chat-mensagens" aria-live="polite">
        <Bolha lado="bot">
          <TextoWhats texto={`Olá! 👋 Sou o *Assistente Ambiental* de ${municipio.nome}. Posso registrar sua *denúncia ambiental* (queimada, desmatamento, lixo, esgoto, barulho…) em poucos passos, com fotos e localização. Também consulto denúncias pelo protocolo.`} />
        </Bolha>
        {msgs.map((m) => (
          <Bolha key={m.id} lado={m.direcao === "IN" ? "cidadao" : "bot"} atendente={m.autor === "ATENDENTE"} testid={m.direcao === "OUT" ? "chat-msg-bot" : "chat-msg-cidadao"}>
            {m.midia && !m.id.startsWith("tmp-") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/v1/public/chat/midia/${m.id}`} alt="Foto enviada" className="mb-1 max-h-48 rounded-md" />
            )}
            {m.tipo === "IMAGEM" && m.id.startsWith("tmp-") && <span className="italic">📷 Enviando foto…</span>}
            {m.texto ? <TextoWhats texto={m.texto} /> : m.local ? <span>📍 Localização enviada</span> : m.tipo === "IMAGEM" ? null : null}
          </Bolha>
        ))}
        {enviando && (
          <div className="flex items-center gap-2 px-2 text-xs text-slate-500" data-testid="chat-digitando"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> digitando…</div>
        )}
        {!msgs.length && !enviando && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="rounded-full border border-primaria-600 bg-white px-3 py-1.5 text-sm text-primaria-700 hover:bg-primaria-50" onClick={() => enviar({ texto: "Quero fazer uma denúncia" })} data-testid="chat-comecar">Quero fazer uma denúncia</button>
            <button type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100" onClick={() => setTexto("DEN-")}>Consultar protocolo</button>
          </div>
        )}
      </div>

      {botoes.length > 0 && !enviando && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-white px-3 py-2" data-testid="chat-botoes">
          {botoes.map((b) => (
            <button key={b.id} type="button" data-testid={`chat-botao-${b.id}`} className="rounded-full border border-primaria-600 px-3 py-1.5 text-sm font-medium text-primaria-700 hover:bg-primaria-50" onClick={() => enviar({ botao: b.id, texto: b.rotulo })}>
              {b.rotulo}
            </button>
          ))}
        </div>
      )}

      {mapa && (
        <div className="border-t border-slate-200 bg-white p-2">
          <p className="mb-1 text-xs text-slate-600">Toque no mapa para marcar o local e confirme.</p>
          <Mapa publico centro={centro} zoom={ponto ? 16 : 13} altura="200px" selecionavel selecionado={ponto} onSelecionar={(lat, lng) => setPonto([lat, lng])} />
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primario btn-sm" disabled={!ponto || enviando} onClick={async () => { if (ponto) { await enviar({ latitude: ponto[0], longitude: ponto[1], texto: "📍 Local marcado no mapa" }); setMapa(false); setPonto(null); } }} data-testid="chat-confirmar-mapa">Enviar este local</button>
            <button type="button" className="btn-secundario btn-sm" onClick={() => setMapa(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {erro && <p className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">{erro}</p>}

      {encerrada ? (
        <div className="border-t border-slate-200 bg-white p-3 text-center">
          <button type="button" className="btn-primario btn-sm" onClick={novaConversa}>Iniciar nova conversa</button>
        </div>
      ) : (
        <form onSubmit={enviarTexto} className="border-t border-slate-200 bg-white p-2">
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
            <label htmlFor="chat-website">Não preencha</label>
            <input id="chat-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={enviarLocalizacao} disabled={enviando} data-testid="chat-localizacao">
              <LocateFixed className="h-3.5 w-3.5" aria-hidden /> Enviar minha localização
            </button>
            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={() => setMapa((v) => !v)} disabled={enviando} data-testid="chat-mapa">
              <MapPin className="h-3.5 w-3.5" aria-hidden /> Marcar no mapa
            </button>
            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={() => arquivo.current?.click()} disabled={enviando} data-testid="chat-foto">
              <Camera className="h-3.5 w-3.5" aria-hidden /> Foto
            </button>
            <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/*" className="hidden" aria-label="Enviar foto" data-testid="chat-arquivo" onChange={(e) => enviarFoto(e.target.files?.[0])} />
          </div>
          <div className="flex items-end gap-2">
            <label htmlFor="chat-texto" className="sr-only">Mensagem</label>
            <textarea
              id="chat-texto"
              data-testid="chat-input"
              className="input min-h-[42px] flex-1 resize-none py-2"
              rows={1}
              maxLength={2000}
              placeholder="Escreva sua mensagem…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviarTexto(); } }}
            />
            <button type="submit" className="btn-primario h-[42px] px-3" disabled={enviando || !texto.trim()} aria-label="Enviar" data-testid="chat-enviar"><Send className="h-4 w-4" /></button>
          </div>
          {aoPreferirFormulario && (
            <p className="mt-2 text-center text-xs text-slate-500">
              <button type="button" className="underline hover:text-slate-800" onClick={aoPreferirFormulario}>Prefiro preencher um formulário</button>
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function Bolha({ lado, atendente, children, testid }: { lado: "bot" | "cidadao"; atendente?: boolean; children: React.ReactNode; testid?: string }) {
  return (
    <div className={clsx("flex", lado === "cidadao" ? "justify-end" : "justify-start")} data-testid={testid}>
      <div className={clsx("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm", lado === "cidadao" ? "rounded-br-sm bg-primaria-700 text-white" : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200")}>
        {atendente && <p className="mb-0.5 text-[11px] font-semibold text-amber-700">Atendente da Secretaria</p>}
        {children}
      </div>
    </div>
  );
}
