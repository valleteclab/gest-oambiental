// Filtros da lista de documentos: formulário GET (a URL é o estado – compartilhável, sem JavaScript).
import Link from "next/link";
import { SeletorMarcadores, type MarcadorChip } from "@/components/ged/seletor-marcadores";
import { CAMPOS_ORDEM, ROTULO_ORDEM, TAMANHOS_PAGINA, temFiltro, type FiltrosDocumentos } from "@/lib/ged/documentos/filtros";
import { ROTULO_SENSIBILIDADE_GED, ROTULO_STATUS_DOCUMENTO_GED, SENSIBILIDADES_GED } from "@/lib/ged/tipos";

const STATUS = Object.keys(ROTULO_STATUS_DOCUMENTO_GED) as (keyof typeof ROTULO_STATUS_DOCUMENTO_GED)[];

export function FiltrosDocumentosForm({ filtros: f, tipos, pastas, marcadores, acao = "/ged/documentos" }: {
  filtros: FiltrosDocumentos;
  tipos: { id: string; nome: string }[];
  pastas: { id: string; caminho_nome: string }[];
  marcadores: MarcadorChip[];
  acao?: string;
}) {
  const avancadoAtivo = !!(f.titulo || f.remetente || f.de || f.ate || f.tipo || f.status || f.pasta || f.marcadores.length || f.sens || f.pessoais || f.arquivados);
  return (
    <form method="get" action={acao} role="search" aria-label="Filtrar documentos" className="card mb-4 space-y-4 p-4" data-testid="filtros-documentos">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="f-q">Buscar no conteúdo dos arquivos</label>
          <input id="f-q" name="q" type="search" className="input" defaultValue={f.q} maxLength={200} placeholder="Ex.: licitação água tratada · use aspas para uma expressão" />
        </div>
        <div className="flex gap-2">
          <button className="btn-primario">Buscar</button>
          {temFiltro(f) && <Link href={acao} prefetch={false} className="btn-secundario">Limpar</Link>}
        </div>
      </div>

      <details open={avancadoAtivo} className="group">
        <summary className="cursor-pointer text-sm font-medium text-primaria-700">Filtros avançados</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="f-titulo">Título</label>
            <input id="f-titulo" name="titulo" className="input" defaultValue={f.titulo} maxLength={200} />
          </div>
          <div>
            <label className="label" htmlFor="f-remetente">Remetente</label>
            <input id="f-remetente" name="remetente" className="input" defaultValue={f.remetente} maxLength={200} />
          </div>
          <div>
            <label className="label" htmlFor="f-de">Data do documento – de</label>
            <input id="f-de" name="de" type="date" className="input" defaultValue={f.de ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="f-ate">Data do documento – até</label>
            <input id="f-ate" name="ate" type="date" className="input" defaultValue={f.ate ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="f-tipo">Tipo</label>
            <select id="f-tipo" name="tipo" className="input" defaultValue={f.tipo ?? ""}>
              <option value="">Todos</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-status">Situação</label>
            <select id="f-status" name="status" className="input" defaultValue={f.status ?? ""}>
              <option value="">Todas (exceto arquivados)</option>
              {STATUS.map((s) => <option key={s} value={s}>{ROTULO_STATUS_DOCUMENTO_GED[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-pasta">Pasta (inclui subpastas)</label>
            <select id="f-pasta" name="pasta" className="input" defaultValue={f.pasta ?? ""}>
              <option value="">Todas</option>
              <option value="sem">Sem pasta</option>
              {pastas.map((p) => <option key={p.id} value={p.id}>{p.caminho_nome}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-sens">Sensibilidade</label>
            <select id="f-sens" name="sens" className="input" defaultValue={f.sens ?? ""}>
              <option value="">Todas</option>
              {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
            </select>
          </div>
        </div>
        {marcadores.length > 0 && <SeletorMarcadores className="mt-3" marcadores={marcadores} selecionados={f.marcadores} name="marcador" legenda="Marcadores (o documento precisa ter todos os selecionados)" />}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="pessoais" value="1" defaultChecked={f.pessoais} /> Contém dados pessoais</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="arquivados" value="1" defaultChecked={f.arquivados} /> Incluir arquivados</label>
        </div>
      </details>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="f-ordem">Ordenar por</label>
          <select id="f-ordem" name="ordem" className="input" defaultValue={`${f.ordem}:${f.dir}`}>
            {CAMPOS_ORDEM.filter((c) => c !== "relevancia" || f.q).flatMap((c) => [
              <option key={`${c}:desc`} value={`${c}:desc`}>{ROTULO_ORDEM[c]} (decrescente)</option>,
              ...(c === "relevancia" ? [] : [<option key={`${c}:asc`} value={`${c}:asc`}>{ROTULO_ORDEM[c]} (crescente)</option>]),
            ])}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-size">Por página</label>
          <select id="f-size" name="size" className="input" defaultValue={String(f.size)}>
            {TAMANHOS_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-end"><button className="btn-secundario w-full sm:w-auto">Aplicar filtros</button></div>
      </div>
    </form>
  );
}
