import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, whereMunicipio } from "@/lib/rbac";
import { fmtDataHora, fmtMoeda } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { listarFiscalizacoes, municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { COR_BADGE_CONSTATACAO, ROTULO_CONSTATACAO, ROTULO_ORIGEM, podeRegistrarVistoria } from "@/lib/fiscalizacao/regras";
import { AbasFiscalizacao } from "./_componentes/abas";
import { SemAcesso } from "./_componentes/sem-acesso";
import { pagina, qs, sp1, type SP } from "./_componentes/util";

export const metadata = { title: "Fiscalização – LicenciaGov" };

const TAM = 20;

export default async function PaginaFiscalizacao({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "fiscalizacao")) return <SemAcesso mensagem="Seu perfil não tem acesso à fiscalização." />;
  const s = await searchParams;
  const filtros = { municipio: sp1(s.municipio), constatacao: sp1(s.constatacao), origem: sp1(s.origem), q: sp1(s.q) };
  const page = pagina(sp1(s.page));
  const escopo = whereMunicipio(u, filtros.municipio);
  const [municipios, lista, denNovas, autosAgg, notEmitidas] = await Promise.all([
    municipiosDoUsuario(u),
    listarFiscalizacoes(u, { municipio_id: filtros.municipio, constatacao: filtros.constatacao as never, origem: filtros.origem as never, q: filtros.q }, { skip: (page - 1) * TAM, take: TAM }),
    prisma.denuncia.count({ where: { ...escopo, status: "NOVA" } }),
    prisma.autoInfracao.aggregate({ where: { ...escopo, status: { not: "CANCELADO" } }, _count: true, _sum: { valor_multa: true } }),
    prisma.notificacao.count({ where: { ...escopo, status: "EMITIDA" } }),
  ]);

  return (
    <div>
      <CabecalhoPagina
        titulo="Fiscalização"
        subtitulo="Vistorias, denúncias, autos de infração e notificações"
        acoes={podeRegistrarVistoria(u) && <Link href="/fiscalizacao/nova" className="btn-primario">+ Nova vistoria</Link>}
      />
      <AbasFiscalizacao ativa="/fiscalizacao" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/fiscalizacao" className="card p-4"><div className="text-xs text-slate-500">Vistorias</div><div className="text-2xl font-semibold" data-testid="total-vistorias">{lista.total}</div></Link>
        <Link href={`/fiscalizacao/denuncias${qs({ status: "NOVA", municipio: filtros.municipio })}`} className="card p-4"><div className="text-xs text-slate-500">Denúncias novas</div><div className="text-2xl font-semibold text-red-700">{denNovas}</div></Link>
        <Link href="/fiscalizacao/autos" className="card p-4"><div className="text-xs text-slate-500">Autos de infração</div><div className="text-2xl font-semibold">{autosAgg._count}</div><div className="text-xs text-slate-600">{fmtMoeda(autosAgg._sum.valor_multa ?? 0)} em multas</div></Link>
        <Link href="/fiscalizacao/notificacoes" className="card p-4"><div className="text-xs text-slate-500">Notificações em aberto</div><div className="text-2xl font-semibold">{notEmitidas}</div></Link>
      </div>

      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="block"><span className="label">Município</span>
          <select name="municipio" defaultValue={filtros.municipio ?? ""} className="input">
            <option value="">Todos</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Constatação</span>
          <select name="constatacao" defaultValue={filtros.constatacao ?? ""} className="input">
            <option value="">Todas</option>
            {Object.entries(ROTULO_CONSTATACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Origem</span>
          <select name="origem" defaultValue={filtros.origem ?? ""} className="input">
            <option value="">Todas</option>
            {Object.entries(ROTULO_ORIGEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Busca</span>
          <input name="q" defaultValue={filtros.q ?? ""} className="input" placeholder="Relato, empreendimento, protocolo" />
        </label>
        <div className="flex items-end gap-2"><button className="btn-primario">Filtrar</button><Link href="/fiscalizacao" className="btn-secundario">Limpar</Link></div>
      </form>

      <Card titulo="Vistorias">
        {lista.itens.length === 0 ? <Vazio>Nenhuma vistoria encontrada.</Vazio> : (
          <>
            <ul className="divide-y divide-slate-100 md:hidden">
              {lista.itens.map((f) => (
                <li key={f.id} className="py-3">
                  <Link href={`/fiscalizacao/${f.id}`} className="block">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{fmtDataHora(f.data_hora)} · {f.municipio.sigla}</span>
                      {f.constatacao && <Badge cor={COR_BADGE_CONSTATACAO[f.constatacao]}>{ROTULO_CONSTATACAO[f.constatacao]}</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">{ROTULO_ORIGEM[f.origem]}{f.denuncia ? ` ${f.denuncia.protocolo}` : ""}{f.empreendimento ? ` · ${f.empreendimento.nome}` : ""}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-slate-700">{f.relato}</div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="tabela">
                <thead><tr><th>Data/hora</th><th>Município</th><th>Origem</th><th>Empreendimento</th><th>Constatação</th><th>Fotos</th><th>Autos/Not.</th><th></th></tr></thead>
                <tbody>
                  {lista.itens.map((f) => (
                    <tr key={f.id}>
                      <td>{fmtDataHora(f.data_hora)}</td>
                      <td>{f.municipio.nome}</td>
                      <td>{ROTULO_ORIGEM[f.origem]}{f.denuncia && <div className="text-xs text-slate-500">{f.denuncia.protocolo}</div>}{f.processo && <div className="text-xs text-slate-500">{f.processo.numero}</div>}</td>
                      <td>{f.empreendimento?.nome ?? "—"}</td>
                      <td>{f.constatacao ? <Badge cor={COR_BADGE_CONSTATACAO[f.constatacao]}>{ROTULO_CONSTATACAO[f.constatacao]}</Badge> : "—"}</td>
                      <td>{f._count.anexos}</td>
                      <td>{f._count.autos} / {f._count.notificacoes}</td>
                      <td><Link href={`/fiscalizacao/${f.id}`} className="text-primaria-700 hover:underline">Abrir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Paginacao page={page} size={TAM} total={lista.total} href={(p) => `/fiscalizacao${qs(filtros, { page: p })}`} />
      </Card>
    </div>
  );
}
