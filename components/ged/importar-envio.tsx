"use client";
// Importação v2 (tela): abas "Enviar pasta" (recomendada) e "Enviar ZIP", destino/tipo/sensibilidade/união de pastas, resumo antes de
// enviar, progresso geral e por arquivo, pausa/retomada/cancelamento e retentativa. Também serve para RETOMAR um lote que ficou em
// "Aguardando envio" (`lote`): o usuário escolhe de novo a mesma pasta/ZIP e só o que falta é enviado.
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui";
import {
  arquivosDoDrop,
  arquivosDoInput,
  enviarPasta,
  enviarZipEmPartes,
  formatarBytes,
  montarPlanoPasta,
  novoControle,
  requisicao,
  type Controle,
  type Destino,
  type PlanoPasta,
  type ProgressoPasta,
  type ProgressoZip,
} from "@/lib/ged/importacao/cliente";
import { LIMITES_PADRAO } from "@/lib/ged/importacao/limites";
import { ROTULO_SENSIBILIDADE_GED, SENSIBILIDADES_GED, type GedSensibilidade } from "@/lib/ged/tipos";

type PastaOpcao = { id: string; caminho_nome: string; sensibilidade_padrao: GedSensibilidade };
type Tipo = { id: string; nome: string };
export type LoteRetomavel = { id: string; origem: "ZIP" | "PASTA"; nome: string };

const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

function Barra({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div role="progressbar" aria-label={rotulo} aria-valuenow={valor} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded bg-slate-200">
      <div className="h-full bg-primaria-600 transition-all" style={{ width: `${valor}%` }} />
    </div>
  );
}

function CamposDestino({ tipos, pastas, valor, onChange }: { tipos: Tipo[]; pastas: PastaOpcao[]; valor: Destino; onChange: (d: Destino) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="pasta_id">Pasta de destino</label>
        <select
          id="pasta_id"
          className="input"
          value={valor.pasta_id ?? ""}
          onChange={(e) => {
            const p = pastas.find((x) => x.id === e.target.value);
            onChange({ ...valor, pasta_id: e.target.value, sensibilidade: p ? p.sensibilidade_padrao : valor.sensibilidade });
          }}
        >
          <option value="">Raiz (as pastas enviadas ficam no topo)</option>
          {pastas.map((p) => <option key={p.id} value={p.id}>{p.caminho_nome}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tipo_id">Tipo de documento (todos)</label>
        <select id="tipo_id" className="input" value={valor.tipo_id ?? ""} onChange={(e) => onChange({ ...valor, tipo_id: e.target.value })}>
          <option value="">Sem tipo</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="sensibilidade">Sensibilidade (todos)</label>
        <select id="sensibilidade" className="input" value={valor.sensibilidade ?? "RESTRITO"} onChange={(e) => onChange({ ...valor, sensibilidade: e.target.value })}>
          {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">Quem enxerga cada documento é definido pelas permissões da pasta onde ele cair.</p>
      </div>
      <div className="flex items-start gap-2 sm:pt-6">
        <input id="unir_pastas" type="checkbox" className="mt-1" checked={!!valor.unir_pastas} onChange={(e) => onChange({ ...valor, unir_pastas: e.target.checked })} />
        <label htmlFor="unir_pastas" className="text-sm">
          Unir pastas repetidas (A/A → A)
          <span className="block text-xs text-slate-500">Desligado por padrão: a estrutura é preservada exatamente como veio. Ligue só se a repetição for um artefato do Windows ao extrair.</span>
        </label>
      </div>
    </div>
  );
}

function useAvisoDeSaida(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [ativo]);
}

function Controles({ controle, pausado, setPausado, onCancelar }: { controle: Controle; pausado: boolean; setPausado: (v: boolean) => void; onCancelar: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secundario btn-sm" onClick={() => { controle.pausado = !pausado; setPausado(!pausado); }}>{pausado ? "Retomar envio" : "Pausar"}</button>
      <button type="button" className="btn-perigo btn-sm" onClick={onCancelar}>Cancelar e descartar</button>
    </div>
  );
}

// ───────────── Pasta ─────────────

function EnviarPasta({ tipos, pastas, lote }: { tipos: Tipo[]; pastas: PastaOpcao[]; lote?: LoteRetomavel }) {
  const router = useRouter();
  const controle = useRef<Controle>(novoControle());
  const [destino, setDestino] = useState<Destino>({ sensibilidade: "RESTRITO" });
  const [plano, setPlano] = useState<PlanoPasta | null>(null);
  const [sobre, setSobre] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [prog, setProg] = useState<ProgressoPasta | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const loteId = useRef<string | undefined>(lote?.id);
  useAvisoDeSaida(enviando);

  const aplicar = (plano: PlanoPasta) => {
    setPlano(plano);
    setProg(null);
    setErro(plano.bloqueio ?? "");
  };

  const iniciar = async () => {
    if (!plano || plano.bloqueio) return;
    setErro("");
    setEnviando(true);
    setPausado(false);
    controle.current = novoControle();
    try {
      const nome = plano.raizes.length === 1 ? plano.raizes[0] : plano.raizes.length > 1 ? `${plano.raizes[0]} e mais ${plano.raizes.length - 1}` : "Pasta";
      const r = await enviarPasta({ plano, destino, nome, loteId: loteId.current, controle: controle.current, onProgresso: setProg, onLote: (id) => (loteId.current = id) });
      if (r.concluido) router.push(`/ged/importar/${r.loteId}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar a pasta.");
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = async () => {
    controle.current.cancelado = true;
    if (loteId.current) await requisicao("DELETE", `/api/v1/ged/importacoes/${loteId.current}`).catch(() => {});
    loteId.current = undefined;
    setEnviando(false);
    setProg(null);
    setPlano(null);
  };

  const r = plano?.resumo;
  const geral = prog ? pct(prog.bytesEnviados, prog.bytesTotal || 1) : 0;
  return (
    <div className="space-y-4" data-testid="aba-pasta">
      {lote && <Aviso tipo="info">Retomando o lote &quot;{lote.nome}&quot;: escolha de novo a <strong>mesma pasta</strong>; só o que ainda não chegou ao servidor será enviado.</Aviso>}
      {!enviando && (
        <label
          htmlFor="pasta-input"
          onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
          onDragLeave={() => setSobre(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setSobre(false);
            setLendo(true);
            try {
              aplicar(montarPlanoPasta(await arquivosDoDrop(e.dataTransfer.items)));
            } catch {
              setErro("Não consegui ler a pasta arrastada. Use o botão para escolher a pasta.");
            } finally {
              setLendo(false);
            }
          }}
          className={clsx("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm focus-within:outline-2 focus-within:outline-primaria-600", sobre ? "border-primaria-600 bg-primaria-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100")}
        >
          <span className="font-medium text-slate-800">{lendo ? "Lendo a pasta…" : plano ? `${plano.raizes.join(", ") || "Seleção"} – ${r!.totalArquivos} arquivo(s)` : "Arraste a pasta para cá ou clique para escolher"}</span>
          <span className="text-xs text-slate-500">Envie a pasta inteira, sem zipar: as subpastas são mantidas. PDFs de até {Math.round(LIMITES_PADRAO.maxArquivoBytes / 1048576)} MB.</span>
          <input
            id="pasta-input"
            type="file"
            multiple
            className="sr-only"
            ref={(el) => { if (el) { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); } }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length) aplicar(montarPlanoPasta(arquivosDoInput(e.target.files)));
              e.target.value = "";
            }}
          />
        </label>
      )}

      {plano && r && !enviando && !prog?.falhas.length && (
        <div className="rounded-md border border-slate-200 p-3 text-sm" data-testid="resumo-pasta">
          <p className="font-medium">Resumo antes de enviar</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li><strong data-testid="resumo-total">{r.totalArquivos}</strong> arquivo(s) na seleção ({formatarBytes(r.totalBytes)}), em {r.pastas} pasta(s).</li>
            <li><strong data-testid="resumo-pdfs">{r.pdfs}</strong> PDF(s) serão enviados ({formatarBytes(r.pdfsBytes)}){r.zipsAninhados > 0 && <>, mais <strong>{r.zipsAninhados}</strong> ZIP(s) que serão abertos como pasta</>}.</li>
            {r.zipsDuplicados > 0 && <li><strong data-testid="resumo-zips-duplicados">{r.zipsDuplicados}</strong> ZIP(s) são cópia da pasta ao lado e <strong>não serão enviados</strong> (o conteúdo já vai pela pasta).</li>}
            {r.grandesDemais > 0 && <li><strong>{r.grandesDemais}</strong> arquivo(s) acima do limite não serão enviados (aparecem no relatório).</li>}
            {Object.keys(r.ignoradosPorTipo).length > 0 && <li data-testid="resumo-ignorados">Ignorados por formato: {Object.entries(r.ignoradosPorTipo).map(([ext, n]) => `${n} ${ext}`).join(", ")}.</li>}
            {plano.ocultos > 0 && <li>{plano.ocultos} arquivo(s) ocultos ou de sistema (Thumbs.db etc.) serão desconsiderados.</li>}
            <li>Total a enviar: <strong>{formatarBytes(r.bytesAEnviar)}</strong>.</li>
          </ul>
        </div>
      )}

      {!lote && (!prog || prog.fase === "falhas") && !enviando && <CamposDestino tipos={tipos} pastas={pastas} valor={destino} onChange={setDestino} />}
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}

      {prog && (
        <div role="status" aria-live="polite" className="space-y-2 text-sm text-slate-700" data-testid="progresso-pasta">
          <Barra valor={geral} rotulo="Progresso geral do envio" />
          <p>
            {prog.fase === "conferindo" ? "Conferindo o que já foi enviado… " : prog.fase === "concluindo" ? "Finalizando… " : prog.fase === "pronto" ? "Envio concluído. " : prog.fase === "cancelado" ? "Envio cancelado. " : ""}
            <strong data-testid="prog-feitos">{prog.feitos}</strong> de {prog.total} arquivo(s) · {formatarBytes(prog.bytesEnviados)} de {formatarBytes(prog.bytesTotal)} ({geral}%)
            {prog.jaNoServidor > 0 && <> · {prog.jaNoServidor} já estavam no servidor</>}
            {pausado && " · pausado"}
          </p>
          {prog.emAndamento.length > 0 && (
            <ul className="space-y-1" aria-label="Arquivos em envio">
              {prog.emAndamento.map((a) => (
                <li key={a.caminho} className="text-xs">
                  <span className="break-all">{a.caminho}</span>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-slate-200"><div className="h-full bg-primaria-500" style={{ width: `${pct(a.enviado, a.total)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          {prog.falhas.length > 0 && !enviando && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="font-medium text-red-800">{prog.falhas.length} arquivo(s) não foram enviados</p>
              <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-xs text-red-800">{prog.falhas.slice(0, 50).map((f) => <li key={f.caminho} className="break-all">{f.caminho}: {f.erro}</li>)}</ul>
              <p className="mt-2 text-xs text-slate-700">Clique em &quot;Tentar novamente&quot;: só o que falta é reenviado. Se a página for fechada, o lote fica em &quot;Aguardando envio&quot; e pode ser retomado depois.</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {enviando ? (
          <Controles controle={controle.current} pausado={pausado} setPausado={setPausado} onCancelar={cancelar} />
        ) : (
          <button type="button" className="btn-primario" disabled={!plano || !!plano.bloqueio} onClick={iniciar}>{prog?.falhas.length ? "Tentar novamente" : "Enviar pasta"}</button>
        )}
      </div>
    </div>
  );
}

// ───────────── ZIP ─────────────

function EnviarZip({ tipos, pastas, lote }: { tipos: Tipo[]; pastas: PastaOpcao[]; lote?: LoteRetomavel }) {
  const router = useRouter();
  const controle = useRef<Controle>(novoControle());
  const [destino, setDestino] = useState<Destino>({ sensibilidade: "RESTRITO" });
  const [arq, setArq] = useState<File | null>(null);
  const [sobre, setSobre] = useState(false);
  const [erro, setErro] = useState("");
  const [prog, setProg] = useState<ProgressoZip | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const loteId = useRef<string | undefined>(lote?.id);
  useAvisoDeSaida(enviando);
  const limiteMb = Math.round(LIMITES_PADRAO.maxZipBytes / 1048576);

  const escolher = (f: File | undefined) => {
    setErro("");
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return setErro("Envie um arquivo ZIP (.zip).");
    if (f.size > LIMITES_PADRAO.maxZipBytes) return setErro(`O ZIP excede o limite de ${limiteMb} MB. Envie a pasta pela aba "Enviar pasta" ou divida em ZIPs menores.`);
    setArq(f);
    setProg(null);
  };

  const iniciar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arq) return setErro("Escolha o arquivo ZIP.");
    setErro("");
    setEnviando(true);
    setPausado(false);
    controle.current = novoControle();
    try {
      const r = await enviarZipEmPartes({ arquivo: arq, destino, loteId: loteId.current, controle: controle.current, onProgresso: setProg, onLote: (id) => (loteId.current = id) });
      if (r.concluido) router.push(`/ged/importar/${r.loteId}`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível enviar o ZIP.");
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = async () => {
    controle.current.cancelado = true;
    if (loteId.current) await requisicao("DELETE", `/api/v1/ged/importacoes/${loteId.current}`).catch(() => {});
    loteId.current = undefined;
    setEnviando(false);
    setProg(null);
  };

  const geral = prog ? pct(prog.bytesEnviados, prog.bytesTotal || 1) : 0;
  return (
    <form aria-label="Importar ZIP" onSubmit={iniciar} className="space-y-4" data-testid="aba-zip">
      {lote && <Aviso tipo="info">Retomando o lote &quot;{lote.nome}&quot;: escolha de novo o <strong>mesmo arquivo ZIP</strong>; só as partes que faltam serão enviadas.</Aviso>}
      <label
        htmlFor="arquivo-zip"
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); escolher(e.dataTransfer.files?.[0]); }}
        className={clsx("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm focus-within:outline-2 focus-within:outline-primaria-600", sobre ? "border-primaria-600 bg-primaria-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100")}
      >
        <span className="font-medium text-slate-800">{arq ? arq.name : "Arraste o ZIP para cá ou clique para escolher"}</span>
        <span className="text-xs text-slate-500">{arq ? formatarBytes(arq.size) : `Somente ZIP, até ${(limiteMb / 1024).toFixed(1).replace(".", ",")} GB. Arquivos grandes são enviados em partes de 8 MB, com retentativa automática.`}</span>
        <input id="arquivo-zip" type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(e) => escolher(e.target.files?.[0])} className="sr-only" disabled={enviando} />
      </label>
      {!lote && !enviando && <CamposDestino tipos={tipos} pastas={pastas} valor={destino} onChange={setDestino} />}
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      {prog && (
        <div role="status" aria-live="polite" className="space-y-2 text-sm text-slate-700" data-testid="progresso-zip">
          <Barra valor={geral} rotulo="Progresso do envio do ZIP" />
          <p>
            {prog.fase === "concluindo" ? "Validando o ZIP… " : prog.fase === "pronto" ? "Envio concluído. " : prog.fase === "cancelado" ? "Envio cancelado. " : ""}
            Parte <strong>{prog.partesFeitas}</strong> de {prog.partesTotal} · {formatarBytes(prog.bytesEnviados)} de {formatarBytes(prog.bytesTotal)} ({geral}%){pausado && " · pausado"}
          </p>
          {prog.falhas.length > 0 && !enviando && <p className="text-red-700">{prog.falhas.length} parte(s) falharam ({prog.falhas.map((f) => f.parte).slice(0, 10).join(", ")}). Clique em &quot;Importar ZIP&quot; para reenviar só as que faltam.</p>}
        </div>
      )}
      {enviando ? (
        <Controles controle={controle.current} pausado={pausado} setPausado={setPausado} onCancelar={cancelar} />
      ) : (
        <button className="btn-primario" disabled={!arq}>Importar ZIP</button>
      )}
    </form>
  );
}

// ───────────── Abas ─────────────

export function ImportarEnvio({ tipos, pastas, lote }: { tipos: Tipo[]; pastas: PastaOpcao[]; lote?: LoteRetomavel }) {
  const [aba, setAba] = useState<"pasta" | "zip">(lote ? (lote.origem === "ZIP" ? "zip" : "pasta") : "pasta");
  const abas: ["pasta" | "zip", string][] = lote ? [[lote.origem === "ZIP" ? "zip" : "pasta", lote.origem === "ZIP" ? "Retomar envio do ZIP" : "Retomar envio da pasta"]] : [["pasta", "Enviar pasta (recomendado)"], ["zip", "Enviar ZIP"]];
  return (
    <div>
      <div role="tablist" aria-label="Forma de envio" className="mb-4 flex flex-wrap gap-2 border-b border-slate-200">
        {abas.map(([k, r]) => (
          <button key={k} role="tab" type="button" id={`aba-${k}`} aria-selected={aba === k} aria-controls={`painel-${k}`} onClick={() => setAba(k)} className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", aba === k ? "border-primaria-600 text-primaria-700" : "border-transparent text-slate-600 hover:text-slate-900")}>{r}</button>
        ))}
      </div>
      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
        {aba === "pasta" ? <EnviarPasta tipos={tipos} pastas={pastas} lote={lote} /> : <EnviarZip tipos={tipos} pastas={pastas} lote={lote} />}
      </div>
    </div>
  );
}
