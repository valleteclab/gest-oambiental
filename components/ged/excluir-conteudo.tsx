"use client";
// Exclusão controlada (docs/ged.md §17): mostra o que será apagado e o que impede, exige digitar a confirmação e acompanha o
// progresso quando a exclusão grande roda em segundo plano. Nada é decidido aqui: o servidor refaz todas as checagens.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui";
import { MOTIVOS_BLOQUEIO, ROTULO_MOTIVO_BLOQUEIO, textoMotivos, fmtMb, type PlanoExclusaoPublico } from "@/lib/ged/exclusao/regras";

type Progresso = {
  id: string; status: "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "FALHOU"; erro: string | null; percentual: number;
  total_documentos: number; documentos_excluidos: number; total_pastas: number; pastas_excluidas: number; versoes_excluidas: number; bytes_excluidos: number; bloqueados: number;
};

type Props = {
  tipo: "DOCUMENTO" | "PASTA" | "IMPORTACAO";
  id: string;
  /** Texto do botão que abre o painel. */
  botao: string;
  /** Para onde ir quando a exclusão termina (o alvo pode não existir mais). */
  depois: string;
  /** Exclusão deste alvo já em andamento/falha (a tela retoma o acompanhamento). */
  ativa?: Progresso | null;
};

const BASE = { DOCUMENTO: "documentos", PASTA: "pastas", IMPORTACAO: "importacoes" } as const;
const ROTULO_ALVO = { DOCUMENTO: "o documento", PASTA: "a pasta, as subpastas e os documentos dentro delas", IMPORTACAO: "os documentos importados por este lote e as pastas que ele criou" } as const;

async function api<T>(url: string, init?: RequestInit): Promise<{ status: number; corpo: T & { message?: string; details?: unknown } }> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const corpo = (await r.json().catch(() => ({}))) as T & { message?: string };
  return { status: r.status, corpo };
}

export function ExcluirConteudo({ tipo, id, botao, depois, ativa }: Props) {
  const router = useRouter();
  const url = `/api/v1/ged/${BASE[tipo]}/${id}/excluir`;
  const [aberto, setAberto] = useState(!!ativa);
  const [plano, setPlano] = useState<PlanoExclusaoPublico | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [apenas, setApenas] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [prog, setProg] = useState<Progresso | null>(ativa ?? null);
  const parado = useRef(false);

  async function abrir() {
    setAberto(true);
    setErro(null);
    setCarregando(true);
    const r = await api<{ plano: PlanoExclusaoPublico }>(url);
    setCarregando(false);
    if (r.status !== 200) return setErro(r.corpo.message ?? "Não foi possível calcular o que seria excluído.");
    setPlano(r.corpo.plano);
  }

  function fechar() {
    setAberto(false);
    setPlano(null);
    setTexto("");
    setApenas(false);
    setErro(null);
  }

  // acompanhamento da exclusão em segundo plano
  useEffect(() => {
    parado.current = false;
    if (!prog || prog.status === "CONCLUIDA" || prog.status === "FALHOU") return;
    const t = setInterval(async () => {
      const r = await api<Progresso>(`/api/v1/ged/exclusoes/${prog.id}`);
      if (parado.current || r.status !== 200) return;
      setProg(r.corpo);
    }, 2000);
    return () => {
      parado.current = true;
      clearInterval(t);
    };
  }, [prog]);

  useEffect(() => {
    if (prog?.status === "CONCLUIDA") {
      const t = setTimeout(() => {
        router.push(depois);
        router.refresh();
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [prog?.status, depois, router]);

  async function excluir() {
    setEnviando(true);
    setErro(null);
    const r = await api<{ exclusao: Progresso; plano: PlanoExclusaoPublico }>(url, { method: "POST", body: JSON.stringify({ confirmacao: texto, apenas_possiveis: apenas }) });
    setEnviando(false);
    if (r.status === 200 || r.status === 202) return setProg(r.corpo.exclusao);
    if (r.status === 409 && r.corpo.details && typeof r.corpo.details === "object" && "alvo" in r.corpo.details) setPlano(r.corpo.details as PlanoExclusaoPublico);
    setErro(r.corpo.message ?? "Não foi possível excluir.");
  }

  async function retomar() {
    if (!prog) return;
    const r = await api<Progresso>(`/api/v1/ged/exclusoes/${prog.id}/retomar`, { method: "POST" });
    if (r.status === 200 || r.status === 202) setProg(r.corpo);
    else setErro(r.corpo.message ?? "Não foi possível retomar.");
  }

  if (!aberto) {
    return <button type="button" className="btn-perigo" onClick={abrir} data-testid="abrir-exclusao">{botao}</button>;
  }

  if (prog) {
    return (
      <div className="space-y-3" data-testid="progresso-exclusao" data-status={prog.status} role="status" aria-live="polite">
        {prog.status === "CONCLUIDA" ? (
          <Aviso tipo="sucesso">Exclusão concluída: {prog.documentos_excluidos} documento(s), {prog.pastas_excluidas} pasta(s), {prog.versoes_excluidas} versão(ões), {fmtMb(prog.bytes_excluidos)}.{prog.bloqueados > 0 ? ` ${prog.bloqueados} documento(s) foram mantidos por terem impedimento.` : ""}</Aviso>
        ) : prog.status === "FALHOU" ? (
          <>
            <Aviso tipo="erro">{prog.erro ?? "A exclusão falhou."} O que já foi excluído não volta; você pode retomar do ponto em que parou.</Aviso>
            <button type="button" className="btn-secundario" onClick={retomar}>Retomar exclusão</button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-700">Excluindo em segundo plano: {prog.documentos_excluidos} de {prog.total_documentos} documento(s) e {prog.pastas_excluidas} de {prog.total_pastas} pasta(s). Você pode sair desta página; o trabalho continua.</p>
            <progress className="w-full" max={100} value={prog.percentual} aria-label="Progresso da exclusão" />
          </>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>
    );
  }

  const bloqueios = plano?.bloqueados_total ?? 0;
  const nadaAExcluir = !!plano && !plano.mensagem_bloqueio && plano.documentos_total === 0 && plano.pastas_total === 0;
  const podeConfirmar = !!plano && !carregando && (bloqueios === 0 || apenas) && (plano.documentos_excluiveis > 0 || plano.pastas_removiveis > 0) && texto.trim() === plano.confirmacao_esperada.trim();

  return (
    <div className="space-y-4 rounded-md border border-red-300 bg-red-50/40 p-4" data-testid="painel-exclusao">
      {carregando && <p className="text-sm" role="status">Calculando o que será excluído…</p>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {plano && (
        <>
          <p className="text-sm font-semibold text-red-800">Esta ação exclui {ROTULO_ALVO[tipo]} DEFINITIVAMENTE e não tem volta.</p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="resumo-exclusao">
            {([["Pastas", plano.pastas_removiveis, "pastas"], ["Documentos", plano.documentos_excluiveis, "documentos"], ["Versões (arquivos)", plano.versoes, "versoes"], ["Tamanho", fmtMb(plano.bytes), "tamanho"]] as const).map(([r, v, k]) => (
              <div key={k} className="rounded-md border border-slate-200 bg-white p-3"><dt className="text-xs text-slate-500">{r}</dt><dd className="text-xl font-semibold" data-testid={`excluir-${k}`}>{v}</dd></div>
            ))}
          </dl>
          <p className="text-xs text-slate-600">O histórico de auditoria é mantido: cada documento e pasta excluídos ficam registrados (número, título, caminho, sha256, quem e quando), e os logs de acesso não são apagados.</p>

          {plano.mensagem_bloqueio && (
            <div className="space-y-3" data-testid="bloqueios-exclusao">
              <Aviso tipo={tipo === "IMPORTACAO" && bloqueios === 0 ? "alerta" : "erro"}>{plano.mensagem_bloqueio}</Aviso>
              {bloqueios > 0 && (
                <>
                  <ul className="text-sm text-slate-700">
                    {MOTIVOS_BLOQUEIO.filter((m) => plano.motivos[m] > 0).map((m) => <li key={m}>{plano.motivos[m]} documento(s): {ROTULO_MOTIVO_BLOQUEIO[m]}</li>)}
                  </ul>
                  <div className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-white">
                    <table className="tabela">
                      <thead><tr><th>Número</th><th>Título</th><th>Pasta</th><th>Motivo</th></tr></thead>
                      <tbody>
                        {plano.bloqueados.map((b, i) => (
                          <tr key={b.id ?? i}>
                            <td className="whitespace-nowrap">{b.id ? <Link className="text-primaria-700 underline" href={`/ged/documentos/${b.id}`} prefetch={false}>{b.numero}</Link> : "—"}</td>
                            <td className="break-words">{b.titulo ?? "—"}</td>
                            <td className="break-words">{b.pasta ?? "—"}</td>
                            <td className="text-xs">{textoMotivos(b.motivos)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {plano.bloqueados_total > plano.bloqueados.length && <p className="text-xs text-slate-600">Mostrando {plano.bloqueados.length} de {plano.bloqueados_total} documentos com impedimento{plano.sem_permissao_total > 0 ? `; ${plano.sem_permissao_total} deles você nem tem acesso para ver` : ""}.</p>}
                  {(plano.documentos_excluiveis > 0 || plano.pastas_removiveis > 0) && (
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={apenas} onChange={(e) => setApenas(e.target.checked)} data-testid="apenas-possiveis" />
                      <span>Excluir apenas os que podem ser excluídos ({plano.documentos_excluiveis} documento(s)); manter os {bloqueios} com impedimento{tipo !== "DOCUMENTO" ? " (as pastas que ainda os contêm também ficam)" : ""}.</span>
                    </label>
                  )}
                </>
              )}
            </div>
          )}
          {nadaAExcluir && <Aviso>Não há mais nada a excluir aqui.</Aviso>}

          {(plano.documentos_excluiveis > 0 || plano.pastas_removiveis > 0) && (
            <div>
              <label className="label" htmlFor={`conf-${id}`}>{tipo === "PASTA" ? <>Para confirmar, digite o nome da pasta: <strong>{plano.confirmacao_esperada}</strong></> : <>Para confirmar, digite <strong>{plano.confirmacao_esperada}</strong></>}</label>
              <input id={`conf-${id}`} className="input" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" data-testid="confirmacao-exclusao" />
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {plano && (plano.documentos_excluiveis > 0 || plano.pastas_removiveis > 0) && (
          <button type="button" className="btn-perigo" disabled={!podeConfirmar || enviando} onClick={excluir} data-testid="confirmar-exclusao">{enviando ? "Excluindo…" : "Excluir definitivamente"}</button>
        )}
        <button type="button" className="btn-secundario" onClick={fechar}>Cancelar</button>
      </div>
    </div>
  );
}
