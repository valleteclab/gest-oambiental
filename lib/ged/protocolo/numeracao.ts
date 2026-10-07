// Numeração do protocolo: PROT-ENT-2026-000123 (um contador anual por cliente e por livro, em GedSequencia).
// Chame SEMPRE dentro da transação que cria o protocolo: o UPDATE ... RETURNING de proximoValorSequencia trava a linha do
// contador até o commit, então chamadas concorrentes se enfileiram (sem repetir nem pular número; se a transação for
// desfeita, o número volta). Mesmo padrão de lib/ged/numeracao.ts.
import type { GedLivroProtocolo } from "@prisma/client";
import { proximoValorSequencia, type GedTx } from "../db";
import { formatarNumeroProtocolo, tipoSequenciaProtocolo } from "./regras";

export async function proximoNumeroProtocolo(tx: GedTx, organizacaoId: string, livro: GedLivroProtocolo, ano: number = new Date().getFullYear()): Promise<{ numero: string; sequencia: number; ano: number }> {
  const sequencia = await proximoValorSequencia(tx, organizacaoId, tipoSequenciaProtocolo(livro), ano);
  return { numero: formatarNumeroProtocolo(livro, ano, sequencia), sequencia, ano };
}
