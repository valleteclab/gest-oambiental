import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { fmtDataHora } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { listarDenuncias, municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { COR_BADGE_DENUNCIA, ROTULO_CANAL, ROTULO_STATUS_DENUNCIA, podeCriarDenuncia } from "@/lib/fiscalizacao/regras";
import { AbasFiscalizacao } from "../_componentes/abas";
import { SemAcesso } from "../_componentes/sem-acesso";
import { pagina, qs, sp1, type SP } from "../_componentes/util";

export const metadata = { title: "Denúncias – LicenciaGov" };
const TAM = 20;

export default async function PaginaDenuncias({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "denuncia")) return <SemAcesso mensagem="Seu perfil não tem acesso às denúncias." />;
  const s = await searchParams;
  const filtros = { municipio: sp1(s.municipio), status: sp1(s.status), q: sp1(s.q) };
  const page = pagina(sp1(s.page));
  const status = filtros.status && filtros.status in ROTULO_STATUS_DENUNCIA ? (filtros.status as keyof typeof ROTULO_STATUS_DENUNCIA) : null;
  const [municipios, lista] = await Promise.all([
    municipiosDoUsuario(u),
    listarDenuncias(u, { municipio_id: filtros.municipio, status, q: filtros.q }, { skip: (page - 1) * TAM, take: TAM }),
  ]);
  return (
    <div>
      <CabecalhoPagina titulo="Denúncias" subtitulo="Fila de denúncias ambientais por município" acoes={podeCriarDenuncia(u) && <Link href="/fiscalizacao/denuncias/nova" className="btn-primario">+ Registrar denúncia</Link>} />
      <AbasFiscalizacao ativa="/fiscalizacao/denuncias" />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <label className="block"><span className="label">Município</span>
          <select name="municipio" defaultValue={filtros.municipio ?? ""} className="input">
            <option value="">Todos</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Situação</span>
          <select name="status" defaultValue={filtros.status ?? ""} className="input">
            <option value="">Todas</option>
            {Object.entries(ROTULO_STATUS_DENUNCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Busca</span>
          <input name="q" defaultValue={filtros.q ?? ""} className="input" placeholder="Protocolo, descrição, endereço" />
        </label>
        <div className="flex items-end gap-2"><button className="btn-primario">Filtrar</button><Link href="/fiscalizacao/denuncias" className="btn-secundario">Limpar</Link></div>
      </form>
      <Card>
        {lista.itens.length === 0 ? <Vazio>Nenhuma denúncia encontrada.</Vazio> : (
          <ul className="divide-y divide-slate-100" data-testid="lista-denuncias">
            {lista.itens.map((d) => (
              <li key={d.id}>
                <Link href={`/fiscalizacao/denuncias/${d.id}`} className="flex flex-col gap-1 py-3 hover:bg-slate-50 sm:flex-row sm:items-start sm:gap-4">
                  <div className="shrink-0 sm:w-48">
                    <div className="font-medium">{d.protocolo}</div>
                    <div className="text-xs text-slate-500">{fmtDataHora(d.created_at)} · {ROTULO_CANAL[d.canal]}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm">{d.descricao}</div>
                    <div className="text-xs text-slate-500">{d.municipio.nome}{d.endereco ? ` · ${d.endereco}` : ""}{d._count.fiscalizacoes ? ` · ${d._count.fiscalizacoes} vistoria(s)` : ""}</div>
                  </div>
                  <div className="shrink-0"><Badge cor={COR_BADGE_DENUNCIA[d.status]}>{ROTULO_STATUS_DENUNCIA[d.status]}</Badge></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Paginacao page={page} size={TAM} total={lista.total} href={(p) => `/fiscalizacao/denuncias${qs(filtros, { page: p })}`} />
      </Card>
    </div>
  );
}
