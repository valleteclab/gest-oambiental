// Numeração de documentos do GED: {SIGLA}-DOC-2026-000123 (sequência por cliente/tipo/ano, em GedSequencia).
// Chame SEMPRE dentro da transação que cria o documento (o lock da linha vale até o commit).
import { exigirEncontrado, proximoValorSequencia, type GedTx } from "./db";

const pad = (n: number, t: number) => String(n).padStart(t, "0");

/** Próximo número formatado: `{SIGLA}-{tipo}-{ano}-{000000}`. `tipo` é o prefixo (ex.: "DOC"). */
export async function proximoNumeroGed(tx: GedTx, organizacaoId: string, tipo: string, ano: number = new Date().getFullYear()): Promise<string> {
  if (!/^[A-Z0-9]{2,10}$/.test(tipo)) throw new Error("GED: tipo de numeração inválido.");
  const org = exigirEncontrado(await tx.organizacao.findUnique({ where: { id: organizacaoId }, select: { sigla: true } }), "Organização não encontrada.");
  const n = await proximoValorSequencia(tx, organizacaoId, tipo, ano);
  return `${org.sigla}-${tipo}-${ano}-${pad(n, 6)}`;
}

/** Atalho: número de documento (`{SIGLA}-DOC-{ano}-{000000}`). */
export const proximoNumeroDocumentoGed = (tx: GedTx, organizacaoId: string, ano?: number) => proximoNumeroGed(tx, organizacaoId, "DOC", ano);
