import Link from "next/link";
import { ACOES_ACESSO, CANAIS_COM, STATUS_COM, paramsDosFiltros, type AbaLogs, type FiltrosLogs } from "@/lib/ged/logs/filtros";
import { EVENTOS_CONFIGURAVEIS, ROTULO_EVENTO } from "@/lib/ged/notificar/regras";
import { ROTULO_EVENTO_PROTOCOLO } from "@/lib/ged/protocolo/templates";

const ROTULO_ABA: Record<AbaLogs, string> = { acessos: "Acessos", alteracoes: "Alterações", comunicacoes: "Comunicações" };
const ROTULO_ACAO: Record<string, string> = { VISUALIZAR: "Visualizou", BAIXAR: "Baixou", BUSCAR: "Buscou", LISTAR: "Listou", NEGADO: "Acesso negado", LOGIN_GED: "Entrou no módulo" };

/** Abas (links que preservam os filtros). */
export function AbasLogs({ f }: { f: FiltrosLogs }) {
  return (
    <nav aria-label="Tipos de log" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {(Object.keys(ROTULO_ABA) as AbaLogs[]).map((a) => (
        <Link
          key={a}
          href={`/ged/logs?${paramsDosFiltros({ ...f, aba: a, page: 1 })}`}
          prefetch={false}
          aria-current={f.aba === a ? "page" : undefined}
          className={`-mb-px rounded-t-md border px-4 py-2 text-sm font-medium ${f.aba === a ? "border-slate-200 border-b-white bg-white text-primaria-800" : "border-transparent text-slate-600 hover:text-primaria-700"}`}
        >
          {ROTULO_ABA[a]}
        </Link>
      ))}
    </nav>
  );
}

/** Formulário GET de filtros (sem JavaScript): período, usuário, documento e o filtro específico de cada aba. */
export function FiltrosLogs({ f, usuarios }: { f: FiltrosLogs; usuarios: { id: string; nome: string }[] }) {
  return (
    <form method="get" action="/ged/logs" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtros dos logs">
      <input type="hidden" name="aba" value={f.aba} />
      <div><label className="label" htmlFor="lg-de">De</label><input id="lg-de" type="date" name="de" className="input" defaultValue={f.de ?? ""} /></div>
      <div><label className="label" htmlFor="lg-ate">Até</label><input id="lg-ate" type="date" name="ate" className="input" defaultValue={f.ate ?? ""} /></div>
      <div>
        <label className="label" htmlFor="lg-usuario">Usuário</label>
        <select id="lg-usuario" name="usuario" className="input" defaultValue={f.usuario_id ?? ""}>
          <option value="">Todos</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      </div>
      <div><label className="label" htmlFor="lg-doc">Documento (número)</label><input id="lg-doc" name="documento" className="input" defaultValue={f.documento ?? ""} placeholder="Ex.: DOC-2026-000123" maxLength={80} /></div>
      {f.aba === "acessos" && (
        <div>
          <label className="label" htmlFor="lg-acao">Ação</label>
          <select id="lg-acao" name="acao" className="input" defaultValue={f.acao ?? ""}>
            <option value="">Todas</option>
            {ACOES_ACESSO.map((a) => <option key={a} value={a}>{ROTULO_ACAO[a]}</option>)}
          </select>
        </div>
      )}
      {f.aba === "alteracoes" && (
        <div><label className="label" htmlFor="lg-acao-t">Ação (contém)</label><input id="lg-acao-t" name="acao" className="input" defaultValue={f.acao ?? ""} placeholder="Ex.: ACL, SETOR, MEMBRO" maxLength={40} /></div>
      )}
      {f.aba === "comunicacoes" && (
        <>
          <div>
            <label className="label" htmlFor="lg-canal">Canal</label>
            <select id="lg-canal" name="canal" className="input" defaultValue={f.canal ?? ""}>
              <option value="">Todos</option>
              {CANAIS_COM.map((c) => <option key={c} value={c}>{c === "EMAIL" ? "E-mail" : "WhatsApp"}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lg-status">Situação</label>
            <select id="lg-status" name="status" className="input" defaultValue={f.status ?? ""}>
              <option value="">Todas</option>
              {STATUS_COM.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lg-evento">Evento</label>
            <select id="lg-evento" name="evento" className="input" defaultValue={f.evento ?? ""}>
              <option value="">Todos</option>
              {EVENTOS_CONFIGURAVEIS.map((e) => <option key={e} value={e}>{ROTULO_EVENTO[e]}</option>)}
              <option value="CONFIRMACAO_WHATSAPP">{ROTULO_EVENTO.CONFIRMACAO_WHATSAPP}</option>
              {Object.entries(ROTULO_EVENTO_PROTOCOLO).map(([e, r]) => <option key={e} value={e}>{r}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button className="btn-primario">Filtrar</button>
        <Link href={`/ged/logs?aba=${f.aba}`} prefetch={false} className="btn-secundario">Limpar</Link>
      </div>
    </form>
  );
}
