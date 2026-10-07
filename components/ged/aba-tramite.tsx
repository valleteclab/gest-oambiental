import { Card } from "@/components/ui";
import { AcoesTramite } from "@/components/ged/tramite/acoes-tramite";
import { LinhaDoTempoTramite } from "@/components/ged/tramite/linha-do-tempo";
import { cienciaPendenteDoDocumento, haRemetenteAnterior, linhaDoTempo, opcoesDestinatarios, posseAtual } from "@/lib/ged/tramite/consultas";
import { isSomenteLeituraGed } from "@/lib/ged/papeis";
import type { PropsAbaGed } from "./tipos-abas";

/** Aba "Trâmite" da página do documento: situação atual, linha do tempo e (com TRAMITAR) as ações. */
export default async function AbaTramite({ ctx, documento }: PropsAbaGed) {
  const podeTramitar = documento.acoes.includes("TRAMITAR") && !isSomenteLeituraGed(ctx);
  const [eventos, posse] = await Promise.all([linhaDoTempo(ctx, documento.id), posseAtual(ctx, documento.id)]);
  const detentor = posse ? [posse.responsavel_nome, posse.setor_nome && `Setor ${posse.setor_nome}`].filter(Boolean).join(" · ") : "";
  let acoes: React.ReactNode = null;
  if (podeTramitar && posse) {
    const [opcoes, pendente, podeDevolver] = await Promise.all([
      opcoesDestinatarios(ctx),
      posse.sou_destinatario ? cienciaPendenteDoDocumento(ctx, documento.id) : Promise.resolve(false),
      posse.sou_destinatario ? haRemetenteAnterior(ctx, documento.id) : Promise.resolve(false),
    ]);
    acoes = <AcoesTramite documentoId={documento.id} opcoes={opcoes} souDestinatario={posse.sou_destinatario} cienciaPendente={pendente} podeDevolver={podeDevolver} arquivado={documento.status === "ARQUIVADO"} />;
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card titulo="Histórico de trâmite">
        <p className="mb-4 text-sm text-slate-700" data-testid="posse-atual">
          {detentor ? <>Com: <strong>{detentor}</strong></> : "Não está em trâmite (sem destinatário atual)."}
        </p>
        <LinhaDoTempoTramite eventos={eventos} />
        <p className="mt-4 text-xs text-slate-500">O histórico é imutável: não pode ser alterado nem excluído.</p>
      </Card>
      {podeTramitar && <Card titulo="Ações">{acoes}</Card>}
    </div>
  );
}
