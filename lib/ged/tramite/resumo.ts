// Contadores baratos (escopados e filtrados por whereGedVisivel) para a página inicial do GED:
//   const r = await resumoTramite(ctx);  → { caixa_entrada, ciencia_pendente, prazos_vencidos, prazos_vencendo }
import type { CtxGed } from "../contratos";
import { carregarCaixaEntrada } from "./consultas";

export type ResumoTramite = {
  /** Documentos na caixa de entrada (não arquivados, visíveis). */
  caixa_entrada: number;
  /** Com envio recebido ainda sem ciência. */
  ciencia_pendente: number;
  /** Prazo do envio já vencido e sem ciência. */
  prazos_vencidos: number;
  /** Prazo vence em até 3 dias e sem ciência. */
  prazos_vencendo: number;
};

export async function resumoTramite(ctx: CtxGed): Promise<ResumoTramite> {
  const itens = await carregarCaixaEntrada(ctx);
  return {
    caixa_entrada: itens.length,
    ciencia_pendente: itens.filter((i) => i.ciencia_pendente).length,
    prazos_vencidos: itens.filter((i) => i.semaforo === "vermelho").length,
    prazos_vencendo: itens.filter((i) => i.semaforo === "amarelo").length,
  };
}
