// GANCHO PARA AS FRENTES B/C: cancela as solicitações de assinatura ABERTAS de um documento.
//
//   Chame DENTRO da transação que edita o documento ou cria uma nova versão (design §3, passo 1: "editar cancela a
//   solicitação e cria nova versão"):
//
//     await ctx.db.$transaction(async (tx) => {
//       await cancelarSolicitacoesAbertas(tx, ctx, documentoId, "Documento editado (nova versão).");
//       …criarVersao(tx, ctx, …)
//     });
//
//   Efeitos: solicitação → CANCELADA; documento EM_ASSINATURA → PUBLICADO; signatários que ainda não decidiram são
//   avisados; auditoria. Assinaturas já registradas permanecem (são imutáveis) como histórico da solicitação cancelada.
//   Não verifica permissão (quem chama já verificou). Sem solicitação aberta não faz nada (devolve 0).
//   Este arquivo é leve de propósito (sem pdf/certificado): pode ser importado por qualquer frente.
import { auditarGed } from "../auditoria";
import type { CtxGed, GedTx } from "../contratos";
import { avisar, EVENTO_CANCELAMENTO } from "./ponte";

export async function cancelarSolicitacoesAbertas(tx: GedTx, ctx: CtxGed, documentoId: string, motivo: string): Promise<number> {
  const abertas = await tx.gedSolicitacaoAssinatura.findMany({ where: { documento_id: documentoId, status: "ABERTA" }, select: { id: true, criada_por_id: true } });
  let n = 0;
  for (const s of abertas) {
    // updateMany com status ABERTA: concorrência com assinar/recusar/expirar nunca sobrescreve um estado final
    const r = await tx.gedSolicitacaoAssinatura.updateMany({ where: { id: s.id, status: "ABERTA" }, data: { status: "CANCELADA", concluida_em: new Date() } });
    if (r.count !== 1) continue;
    n++;
    const pendentes = await tx.gedAssinante.findMany({ where: { solicitacao_id: s.id, status: { in: ["PENDENTE", "AGUARDANDO"] } }, select: { id: true, usuario_id: true } });
    for (const p of pendentes) await avisar(tx, ctx, EVENTO_CANCELAMENTO, { usuario_ids: [p.usuario_id], documento_id: documentoId, assinante_id: p.id, dados: { motivo, cancelada: "1" } });
    await auditarGed(ctx, { acao: "GED_ASSINATURA_CANCELADA", entidade: "ged_solicitacao_assinatura", entidade_id: s.id, antes: { status: "ABERTA" }, depois: { status: "CANCELADA", motivo } }, tx);
  }
  if (n > 0) await tx.gedDocumento.updateMany({ where: { id: documentoId, status: "EM_ASSINATURA" }, data: { status: "PUBLICADO" } });
  return n;
}
