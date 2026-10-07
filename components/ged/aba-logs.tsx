// Aba "Logs" da página do documento: acessos, comunicações e alterações DESTE documento (GED_AUDITOR/GED_ADMIN ou ADMINISTRAR).
import { Card } from "@/components/ui";
import { TabelaAcessos, TabelaAlteracoes, TabelaComunicacoes } from "@/components/ged/logs/tabelas";
import { logsDoDocumento, podeVerLogsDoDocumento } from "@/lib/ged/logs/consulta";
import type { PropsAbaGed } from "./tipos-abas";

export default async function AbaLogs({ ctx, documento }: PropsAbaGed) {
  if (!podeVerLogsDoDocumento(ctx, documento.acoes)) return null;
  const l = await logsDoDocumento(ctx, documento.id, documento.acoes);
  return (
    <div className="space-y-4" data-testid="aba-logs">
      <Card titulo={`Acessos (${l.acessos.length})`}><TabelaAcessos itens={l.acessos} /></Card>
      <Card titulo={`Comunicações (${l.comunicacoes.length})`}><TabelaComunicacoes itens={l.comunicacoes} /></Card>
      <Card titulo={`Alterações (${l.alteracoes.length})`}><TabelaAlteracoes itens={l.alteracoes} /></Card>
      <p className="text-xs text-slate-500">Mostram-se os 50 registros mais recentes de cada tipo. Para o histórico completo e filtros, use <a className="underline" href={`/ged/logs?documento=${encodeURIComponent(documento.numero)}`}>Logs</a>.</p>
    </div>
  );
}
