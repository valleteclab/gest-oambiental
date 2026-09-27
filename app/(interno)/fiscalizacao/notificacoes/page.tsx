import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { semaforo } from "@/lib/dias";
import { fmtData } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Paginacao, PontoSemaforo, Vazio } from "@/components/ui";
import { listarNotificacoes, municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { ROTULO_STATUS_NOTIFICACAO, podeEmitirFiscalizacao } from "@/lib/fiscalizacao/regras";
import { AbasFiscalizacao } from "../_componentes/abas";
import { SemAcesso } from "../_componentes/sem-acesso";
import { BotaoPdf } from "../_componentes/botao-pdf";
import { pagina, qs, sp1, type SP } from "../_componentes/util";

export const metadata = { title: "Notificações – LicenciaGov" };
const TAM = 20;

export default async function PaginaNotificacoes({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "fiscalizacao")) return <SemAcesso mensagem="Seu perfil não tem acesso à fiscalização." />;
  const s = await searchParams;
  const filtros = { municipio: sp1(s.municipio), status: sp1(s.status) };
  const page = pagina(sp1(s.page));
  const status = filtros.status && filtros.status in ROTULO_STATUS_NOTIFICACAO ? filtros.status : null;
  const [municipios, lista] = await Promise.all([municipiosDoUsuario(u), listarNotificacoes(u, { municipio_id: filtros.municipio, status }, { skip: (page - 1) * TAM, take: TAM })]);
  return (
    <div>
      <CabecalhoPagina titulo="Notificações" subtitulo={`${lista.total} notificação(ões)`} />
      <AbasFiscalizacao ativa="/fiscalizacao/notificacoes" />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-3" method="get">
        <label className="block"><span className="label">Município</span>
          <select name="municipio" defaultValue={filtros.municipio ?? ""} className="input"><option value="">Todos</option>{municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
        </label>
        <label className="block"><span className="label">Situação</span>
          <select name="status" defaultValue={filtros.status ?? ""} className="input"><option value="">Todas</option>{Object.entries(ROTULO_STATUS_NOTIFICACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <div className="flex items-end gap-2"><button className="btn-primario">Filtrar</button><Link href="/fiscalizacao/notificacoes" className="btn-secundario">Limpar</Link></div>
      </form>
      <Card>
        {lista.itens.length === 0 ? <Vazio>Nenhuma notificação.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Número</th><th>Emissão</th><th>Notificado</th><th>Exigência</th><th>Prazo</th><th>Situação</th><th>PDF</th></tr></thead>
              <tbody>
                {lista.itens.map((n) => (
                  <tr key={n.id}>
                    <td>{n.fiscalizacao ? <Link href={`/fiscalizacao/${n.fiscalizacao.id}#notificacao-${n.id}`} className="font-medium text-primaria-700 hover:underline">{n.numero}</Link> : n.numero}{n.processo && <div className="text-xs text-slate-500">{n.processo.numero}</div>}</td>
                    <td>{fmtData(n.created_at)}</td>
                    <td>{n.notificado.nome}<div className="text-xs text-slate-500">{n.notificado.cpf_cnpj_mascara}</div></td>
                    <td className="max-w-xs"><span className="line-clamp-2">{n.exigencia}</span></td>
                    <td className="whitespace-nowrap">{n.status === "EMITIDA" && <PontoSemaforo s={semaforo(n.prazo_ate, 5)} />} {fmtData(n.prazo_ate)}</td>
                    <td><Badge>{ROTULO_STATUS_NOTIFICACAO[n.status]}</Badge></td>
                    <td><BotaoPdf tipo="notificacoes" id={n.id} documentoId={n.documento_id} podeEmitir={podeEmitirFiscalizacao(u, n.municipio_id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={TAM} total={lista.total} href={(p) => `/fiscalizacao/notificacoes${qs(filtros, { page: p })}`} />
      </Card>
    </div>
  );
}
