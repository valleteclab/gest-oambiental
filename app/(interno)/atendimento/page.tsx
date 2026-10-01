import Link from "next/link";
import type { EstadoConversa, TipoCanal } from "@prisma/client";
import { exigirUsuario } from "@/lib/auth";
import { fmtDataHora } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { listarConversas, podeVerAtendimento } from "@/lib/agente/atendimento";
import { COR_ESTADO, ROTULO_CANAL_CURTO, ROTULO_ESTADO } from "@/lib/agente/rotulos";
import { ROTULO_TIPO_CANAL } from "@/lib/canais";
import { municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { iaHabilitada } from "@/lib/agente/llm";
import { SemAcesso } from "../fiscalizacao/_componentes/sem-acesso";
import { pagina, qs, sp1, type SP } from "../fiscalizacao/_componentes/util";

export const metadata = { title: "Atendimento – LicenciaGov" };
export const dynamic = "force-dynamic";
const TAM = 25;

export default async function PaginaAtendimento({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!podeVerAtendimento(u)) return <SemAcesso />;
  const s = await searchParams;
  const f = { municipio: sp1(s.municipio), estado: sp1(s.estado), canal: sp1(s.canal) };
  const page = pagina(sp1(s.page));
  const estado = f.estado && f.estado in ROTULO_ESTADO ? (f.estado as EstadoConversa) : null;
  const canal = f.canal && f.canal in ROTULO_TIPO_CANAL ? (f.canal as TipoCanal) : null;
  const [municipios, lista] = await Promise.all([municipiosDoUsuario(u), listarConversas(u, { municipio_id: f.municipio, estado, canal }, { skip: (page - 1) * TAM, take: TAM })]);
  return (
    <div>
      <CabecalhoPagina
        titulo="Atendimento"
        subtitulo={<>Conversas do Assistente Ambiental (WhatsApp, chat do site e e-mail) · {iaHabilitada() ? "IA ativa" : "modo questionário (sem IA)"}</>}
      />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <label className="block"><span className="label">Município</span>
          <select name="municipio" defaultValue={f.municipio ?? ""} className="input">
            <option value="">Todos</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Canal</span>
          <select name="canal" defaultValue={f.canal ?? ""} className="input">
            <option value="">Todos</option>
            {Object.entries(ROTULO_TIPO_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Situação</span>
          <select name="estado" defaultValue={f.estado ?? ""} className="input">
            <option value="">Todas</option>
            {Object.entries(ROTULO_ESTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2"><button className="btn-primario">Filtrar</button><Link href="/atendimento" className="btn-secundario">Limpar</Link></div>
      </form>
      <Card>
        {lista.itens.length === 0 ? <Vazio>Nenhuma conversa encontrada.</Vazio> : (
          <ul className="divide-y divide-slate-100" data-testid="lista-conversas">
            {lista.itens.map((c) => {
              const ultima = c.mensagens[0];
              return (
                <li key={c.id}>
                  <Link href={`/atendimento/${c.id}`} className="flex flex-col gap-1 py-3 hover:bg-slate-50 sm:flex-row sm:items-start sm:gap-4">
                    <div className="shrink-0 sm:w-56">
                      <div className="font-medium">{c.nome ?? c.contato ?? "Cidadão"}</div>
                      <div className="text-xs text-slate-500">{ROTULO_CANAL_CURTO[c.canal.tipo]} · {fmtDataHora(c.ultima_msg_em)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm text-slate-700">{ultima ? `${ultima.direcao === "OUT" ? "↩ " : ""}${ultima.texto ?? `[${ultima.tipo.toLowerCase()}]`}` : "—"}</div>
                      <div className="text-xs text-slate-500">{c.municipio?.nome ?? "Município a definir"}{c.denuncia ? ` · ${c.denuncia.protocolo}` : ""}</div>
                    </div>
                    <div className="shrink-0"><Badge cor={COR_ESTADO[c.estado]}>{ROTULO_ESTADO[c.estado]}</Badge></div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Paginacao page={page} size={TAM} total={lista.total} href={(p) => `/atendimento${qs(f, { page: p })}`} />
      </Card>
    </div>
  );
}
