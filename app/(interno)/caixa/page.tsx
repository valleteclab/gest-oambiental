import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, temPapel } from "@/lib/rbac";
import { semaforo } from "@/lib/dias";
import { CabecalhoPagina, Card } from "@/components/ui";
import { diasAlertaDe, mapaDiasAlerta, SELECT_LISTA, whereProcessos } from "@/lib/processo/consultas";
import { STATUS_ATIVOS } from "@/lib/processo/maquina";
import { TabelaProcessos } from "../processos/_componentes/tabela-processos";

export const metadata = { title: "Caixa de entrada" };

/** Caixa de entrada: processos sob minha responsabilidade ordenados por prazo (SPEC 10). */
export default async function PaginaCaixa() {
  const u = await exigirUsuario({ interno: true });
  const gestor = temPapel(u, "GESTOR_MUNICIPAL", "ADMIN");
  const municipiosGestor = u.papeis.filter((p) => p.papel === "GESTOR_MUNICIPAL" && p.municipio_id).map((p) => p.municipio_id!);
  const escopo = whereProcessos(u, { incluirRascunhos: false });
  const ordem = [{ prazo_etapa_ate: { sort: "asc" as const, nulls: "last" as const } }, { data_protocolo: "asc" as const }];

  const [alertas, meus, decisao, distribuir] = await Promise.all([
    mapaDiasAlerta(u.organizacao_id),
    prisma.processo.findMany({ where: { AND: [escopo, { tecnico_id: u.id, status: { in: STATUS_ATIVOS } }] }, select: SELECT_LISTA, orderBy: ordem, take: 200 }),
    gestor
      ? prisma.processo.findMany({ where: { AND: [escopo, { status: "AGUARDANDO_DECISAO" }, temPapel(u, "ADMIN") ? {} : { municipio_id: { in: municipiosGestor } }] }, select: SELECT_LISTA, orderBy: ordem, take: 200 })
      : Promise.resolve([]),
    can(u, "triar", "processo") ? prisma.processo.findMany({ where: { AND: [escopo, { status: "PROTOCOLADO" }] }, select: SELECT_LISTA, orderBy: ordem, take: 200 }) : Promise.resolve([]),
  ]);
  const contar = (l: typeof meus) => ({ vencidos: l.filter((p) => semaforo(p.prazo_etapa_ate, diasAlertaDe(alertas, p.municipio.id, p.etapa_atual), p.prazo_pausado) === "vermelho").length, vencendo: l.filter((p) => semaforo(p.prazo_etapa_ate, diasAlertaDe(alertas, p.municipio.id, p.etapa_atual), p.prazo_pausado) === "amarelo").length });
  const c = contar(meus);
  return (
    <>
      <CabecalhoPagina titulo="Caixa de entrada" subtitulo={`${meus.length} processo(s) sob sua responsabilidade · ${c.vencidos} vencido(s) · ${c.vencendo} vencendo`} acoes={<Link href="/processos" className="btn-secundario">Todos os processos</Link>} />
      <div className="space-y-5">
        {distribuir.length > 0 && (
          <Card titulo={`Aguardando distribuição (${distribuir.length})`}>
            <TabelaProcessos itens={distribuir} alertas={alertas} />
          </Card>
        )}
        {gestor && (
          <Card titulo={`Aguardando decisão (${decisao.length})`}>
            <TabelaProcessos itens={decisao} alertas={alertas} vazio="Nenhum processo aguardando decisão." />
          </Card>
        )}
        <Card titulo="Meus processos (por prazo)">
          <TabelaProcessos itens={meus} alertas={alertas} vazio="Nenhum processo distribuído para você." />
        </Card>
      </div>
    </>
  );
}
