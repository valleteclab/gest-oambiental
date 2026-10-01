import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { fmtData, fmtMoeda } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { listarAutos, municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { ROTULO_PENALIDADE, ROTULO_STATUS_AUTO, podeEmitirFiscalizacao } from "@/lib/fiscalizacao/regras";
import { AbasFiscalizacao } from "../_componentes/abas";
import { SemAcesso } from "../_componentes/sem-acesso";
import { BotaoPdf } from "../_componentes/botao-pdf";
import { pagina, qs, sp1, type SP } from "../_componentes/util";

export const metadata = { title: "Autos de infração – LicenciaGov" };
const TAM = 20;

export default async function PaginaAutos({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "fiscalizacao")) return <SemAcesso mensagem="Seu perfil não tem acesso à fiscalização." />;
  const s = await searchParams;
  const filtros = { municipio: sp1(s.municipio), status: sp1(s.status), penalidade: sp1(s.penalidade) };
  const page = pagina(sp1(s.page));
  const status = filtros.status && filtros.status in ROTULO_STATUS_AUTO ? filtros.status : null;
  const penalidade = filtros.penalidade && filtros.penalidade in ROTULO_PENALIDADE ? filtros.penalidade : null;
  const [municipios, lista] = await Promise.all([municipiosDoUsuario(u), listarAutos(u, { municipio_id: filtros.municipio, status, penalidade }, { skip: (page - 1) * TAM, take: TAM })]);
  return (
    <div>
      <CabecalhoPagina titulo="Autos de infração" subtitulo={<>{lista.total} auto(s) · total de multas{status ? "" : " (exceto cancelados)"}: <strong data-testid="total-multas">{fmtMoeda(lista.valor_total_multas)}</strong></>} />
      <AbasFiscalizacao ativa="/fiscalizacao/autos" />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <label className="block"><span className="label">Município</span>
          <select name="municipio" defaultValue={filtros.municipio ?? ""} className="input"><option value="">Todos</option>{municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
        </label>
        <label className="block"><span className="label">Situação</span>
          <select name="status" defaultValue={filtros.status ?? ""} className="input"><option value="">Todas</option>{Object.entries(ROTULO_STATUS_AUTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="block"><span className="label">Penalidade</span>
          <select name="penalidade" defaultValue={filtros.penalidade ?? ""} className="input"><option value="">Todas</option>{Object.entries(ROTULO_PENALIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <div className="flex items-end gap-2"><button className="btn-primario">Filtrar</button><Link href="/fiscalizacao/autos" className="btn-secundario">Limpar</Link></div>
      </form>
      <Card>
        {lista.itens.length === 0 ? <Vazio>Nenhum auto de infração.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Número</th><th>Data</th><th>Município</th><th>Autuado</th><th>Penalidade</th><th className="text-right">Multa</th><th>Situação</th><th>PDF</th></tr></thead>
              <tbody>
                {lista.itens.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/fiscalizacao/${a.fiscalizacao_id}#auto-${a.id}`} className="font-medium text-primaria-700 hover:underline">{a.numero}</Link></td>
                    <td>{fmtData(a.created_at)}</td>
                    <td>{a.fiscalizacao.municipio.sigla}</td>
                    <td>{a.autuado.nome}<div className="text-xs text-slate-500">{a.autuado.cpf_cnpj_mascara}</div></td>
                    <td>{ROTULO_PENALIDADE[a.penalidade]}</td>
                    <td className="text-right">{a.valor_multa ? fmtMoeda(a.valor_multa) : "—"}</td>
                    <td><Badge>{ROTULO_STATUS_AUTO[a.status]}</Badge></td>
                    <td><BotaoPdf tipo="autos-infracao" id={a.id} documentoId={a.documento_id} podeEmitir={podeEmitirFiscalizacao(u, a.municipio_id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={TAM} total={lista.total} href={(p) => `/fiscalizacao/autos${qs(filtros, { page: p })}`} />
      </Card>
    </div>
  );
}
