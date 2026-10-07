import Link from "next/link";
import { Aviso, Badge, CabecalhoPagina, Paginacao } from "@/components/ui";
import { exigirGed } from "@/lib/ged/escopo";
import { filtrosParaQueryProtocolo, lerFiltrosProtocolo, listarProtocolos, opcoesProtocolo } from "@/lib/ged/protocolo/servico";
import { anoBrasilia, COR_SITUACAO, LIVROS, podeRegistrarProtocolo, ROTULO_LIVRO, ROTULO_PRIORIDADE, ROTULO_SITUACAO, SITUACOES } from "@/lib/ged/protocolo/regras";
import { veTodosProtocolos } from "@/lib/ged/papeis";
import { fmtDataHora } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Protocolo – Gestão de Documentos" };

const COR_SEMAFORO = { verde: "text-emerald-700", amarelo: "text-amber-700", vermelho: "text-red-700", cinza: "text-slate-500" } as const;

export default async function PaginaProtocolo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigirGed();
  const f = lerFiltrosProtocolo(await searchParams);
  const [r, opcoes] = await Promise.all([listarProtocolos(ctx, f), opcoesProtocolo(ctx)]);
  const href = (p: number) => `/ged/protocolo${filtrosParaQueryProtocolo(f, { page: p })}`;
  const anoAtual = anoBrasilia();
  const filtrando = !!(f.livro || f.ano || f.situacao || f.setor_id || f.q || f.meus);
  return (
    <>
      <CabecalhoPagina
        titulo="Protocolo"
        subtitulo="Livro de entrada, saída e controle interno de documentos, com número, comprovante e andamento."
        acoes={podeRegistrarProtocolo(ctx.membro.papel) ? <Link href="/ged/protocolo/novo" prefetch={false} className="btn-primario">Novo protocolo</Link> : undefined}
      />
      <form method="get" action="/ged/protocolo" role="search" aria-label="Filtrar protocolos" className="card mb-4 space-y-3 p-4" data-testid="filtros-protocolo">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="label" htmlFor="p-q">Buscar</label>
            <input id="p-q" name="q" type="search" className="input" defaultValue={f.q ?? ""} maxLength={120} placeholder="Número, assunto, descrição ou CPF/CNPJ" />
          </div>
          <div>
            <label className="label" htmlFor="p-livro">Livro</label>
            <select id="p-livro" name="livro" className="input" defaultValue={f.livro ?? ""}>
              <option value="">Todos</option>
              {LIVROS.map((l) => <option key={l} value={l}>{ROTULO_LIVRO[l]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-ano">Ano</label>
            <select id="p-ano" name="ano" className="input" defaultValue={f.ano ? String(f.ano) : ""}>
              <option value="">Todos</option>
              {[anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-situacao">Situação</label>
            <select id="p-situacao" name="situacao" className="input" defaultValue={f.situacao ?? ""}>
              <option value="">Todas</option>
              {SITUACOES.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-setor">Setor</label>
            <select id="p-setor" name="setor" className="input" defaultValue={f.setor_id ?? ""}>
              <option value="">Todos</option>
              {opcoes.setores.map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.sigla})</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="meus" value="1" defaultChecked={f.meus} className="accent-emerald-700" /> Só os meus / do meu setor</label>
          </div>
          <div className="flex items-end gap-2 lg:col-span-2">
            <button className="btn-primario">Filtrar</button>
            {filtrando && <Link href="/ged/protocolo" prefetch={false} className="btn-secundario">Limpar</Link>}
          </div>
        </div>
      </form>
      {!veTodosProtocolos(ctx) && <div className="mb-3"><Aviso>Você vê os protocolos em que está envolvido ou que pertencem ao seu setor.</Aviso></div>}
      <p className="mb-2 text-sm text-slate-600" aria-live="polite" data-testid="total-protocolos">{r.total} protocolo(s) encontrado(s)</p>
      {r.linhas.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-600">Nenhum protocolo encontrado.</p>
      ) : (
        <ul className="space-y-3" aria-label="Protocolos">
          {r.linhas.map((p) => (
            <li key={p.id} className="card p-4" data-testid="protocolo-item">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/ged/protocolo/${p.id}`} prefetch={false} className="break-words text-base font-semibold text-primaria-700 hover:underline">{p.numero}</Link>
                  <div className="mt-0.5 break-words text-sm text-slate-800">{p.assunto}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge cor="cinza">{ROTULO_LIVRO[p.livro]}</Badge>
                  <Badge cor={COR_SITUACAO[p.situacao]}>{p.situacao_rotulo}</Badge>
                  {p.prioridade !== "NORMAL" && <Badge cor={p.prioridade === "URGENTE" ? "vermelho" : p.prioridade === "ALTA" ? "amarelo" : "cinza"}>{ROTULO_PRIORIDADE[p.prioridade]}</Badge>}
                  {p.origem === "PORTAL" && <Badge cor="azul">Portal</Badge>}
                </div>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="inline text-slate-500">Registrado em: </dt><dd className="inline">{fmtDataHora(p.created_at)}</dd></div>
                {p.interessado && <div><dt className="inline text-slate-500">{p.livro === "SAIDA" ? "Destinatário" : "Interessado"}: </dt><dd className="inline break-words">{p.interessado}</dd></div>}
                {p.com && <div><dt className="inline text-slate-500">Com: </dt><dd className="inline break-words">{p.com}</dd></div>}
                {p.prazo_resposta_em && <div><dt className="inline text-slate-500">Prazo: </dt><dd className={`inline ${COR_SEMAFORO[p.semaforo] ?? ""}`}>{fmtDataHora(p.prazo_resposta_em).slice(0, 10)}</dd></div>}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <Paginacao page={r.page} size={r.size} total={r.total} href={href} />
    </>
  );
}
