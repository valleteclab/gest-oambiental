import Link from "next/link";
import type { StatusProcesso } from "@prisma/client";
import { fmtData } from "@/lib/format";
import { diasRestantes, semaforo } from "@/lib/dias";
import { BadgeStatus, PontoSemaforo, Vazio } from "@/components/ui";

export type LinhaProcesso = {
  id: string;
  numero: string | null;
  status: StatusProcesso;
  data_protocolo: Date | null;
  prazo_etapa_ate: Date | null;
  prazo_pausado: boolean;
  municipio: { sigla: string; nome: string };
  tipo_ato: { sigla: string; nome: string };
  empreendimento: { nome: string };
  requerente: { nome: string };
  tecnico: { nome: string } | null;
};

function Prazo({ p }: { p: LinhaProcesso }) {
  const s = semaforo(p.prazo_etapa_ate, 5, p.prazo_pausado);
  const r = p.prazo_etapa_ate ? diasRestantes(p.prazo_etapa_ate) : null;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <PontoSemaforo s={s} />
      {p.prazo_etapa_ate ? (
        <span>
          {fmtData(p.prazo_etapa_ate)}
          <span className="block text-xs text-slate-500">{p.prazo_pausado ? "pausado" : r! >= 0 ? `${r} dia(s)` : `vencido há ${-r!} dia(s)`}</span>
        </span>
      ) : (
        "—"
      )}
    </span>
  );
}

export function TabelaProcessos({ itens, vazio = "Nenhum processo encontrado." }: { itens: LinhaProcesso[]; vazio?: string }) {
  if (!itens.length) return <Vazio>{vazio}</Vazio>;
  return (
    <div className="overflow-x-auto">
      <table className="tabela" data-testid="tabela-processos">
        <thead>
          <tr><th>Prazo</th><th>Processo</th><th>Empreendimento / requerente</th><th>Tipo</th><th>Município</th><th>Status</th><th>Técnico</th></tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={p.id}>
              <td><Prazo p={p} /></td>
              <td className="whitespace-nowrap">
                <Link href={`/processos/${p.id}`} className="font-medium text-primaria-700 hover:underline">{p.numero ?? "Rascunho"}</Link>
                <div className="text-xs text-slate-500">{fmtData(p.data_protocolo)}</div>
              </td>
              <td>{p.empreendimento.nome}<div className="text-xs text-slate-500">{p.requerente.nome}</div></td>
              <td title={p.tipo_ato.nome}>{p.tipo_ato.sigla}</td>
              <td>{p.municipio.nome}</td>
              <td><BadgeStatus status={p.status} /></td>
              <td>{p.tecnico?.nome ?? <span className="text-slate-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
