// "Reprocessar OCR" (GED_ADMIN/GED_GESTOR com EDITAR no documento): recoloca a versão atual na fila do OCR.
import { proibido, invalido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { exigirDocumento } from "../permissoes";
import { ocrReprocessavel, podeReprocessarOcrPapel } from "./decisao";
import { agendarOcr, iniciarOcrInline } from "./servico";

export async function reprocessarOcrDocumento(ctx: CtxGed, documentoId: string): Promise<void> {
  if (!podeReprocessarOcrPapel(ctx.membro.papel)) throw proibido("Somente administradores e gestores podem reprocessar o OCR.");
  await exigirDocumento(ctx, documentoId, "EDITAR");
  const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: documentoId }, select: { status: true, versao_atual_id: true } }), "Documento não encontrado.");
  if (!d.versao_atual_id) throw invalido("O documento ainda não tem arquivo.");
  const v = exigirEncontrado(await ctx.db.gedVersaoDocumento.findUnique({ where: { id: d.versao_atual_id }, select: { id: true, origem: true, selada: true, ocr_status: true, texto_status: true } }));
  if (!ocrReprocessavel(v, d.status)) throw invalido("A versão atual não admite novo OCR (já processada, em andamento, com texto ou documento assinado).");
  if ((await agendarOcr(ctx.organizacao_id, v.id, { forcar: true })) !== "AGENDADO") throw invalido("Não foi possível agendar o OCR desta versão.");
  await auditarGed(ctx, { acao: "GED_OCR_REPROCESSADO", entidade: "ged_versao_documento", entidade_id: v.id, antes: { ocr_status: v.ocr_status }, depois: { ocr_status: "PENDENTE", documento_id: documentoId } });
  void iniciarOcrInline(ctx.organizacao_id, v.id).catch(() => {});
}
