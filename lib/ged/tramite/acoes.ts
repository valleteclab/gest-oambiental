// Ações de trâmite com checagem de permissão (TRAMITAR) – usadas por Server Actions e rotas /api/v1/ged/tramite.
// Cada ação: exigirDocumento(ctx, id, "TRAMITAR") (404 sem VER, 403 com VER sem TRAMITAR) → transação → registrarTramite.
import { z } from "zod";
import { invalido, proibido } from "@/lib/http";
import type { CtxGed } from "../contratos";
import { exigirDocumento } from "../permissoes";
import { ehDestinatarioAtual, MAX_DESPACHO } from "./regras";
import { registrarTramite } from "./servico";

const zUuid = z.string().uuid("Identificador inválido.");
const zDespacho = z.string().max(MAX_DESPACHO, `O despacho deve ter no máximo ${MAX_DESPACHO} caracteres.`).optional().nullable();

/** `prazo` aceita ISO com fuso ou só data (vale até o fim do dia, horário de Brasília). Vazio → undefined. */
export function lerPrazo(v: string | null | undefined): Date | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59.999-03:00`) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? new Date(`${s}:00-03:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) throw invalido("Prazo inválido.");
  return d;
}

export const zEnviar = z.object({
  documento_id: zUuid,
  destino: z.discriminatedUnion("tipo", [z.object({ tipo: z.literal("USUARIO"), id: zUuid }), z.object({ tipo: z.literal("SETOR"), id: zUuid })]),
  despacho: zDespacho,
  prazo: z.string().optional().nullable(),
});

export async function enviarDocumento(ctx: CtxGed, entrada: unknown) {
  const e = zEnviar.parse(entrada);
  await exigirDocumento(ctx, e.documento_id, "TRAMITAR");
  return ctx.db.$transaction((tx) =>
    registrarTramite(tx, ctx, {
      documento_id: e.documento_id,
      tipo: "ENVIO",
      para_usuario_id: e.destino.tipo === "USUARIO" ? e.destino.id : undefined,
      para_setor_id: e.destino.tipo === "SETOR" ? e.destino.id : undefined,
      despacho: e.despacho ?? undefined,
      prazo_em: lerPrazo(e.prazo),
    }),
  );
}

const zSimples = z.object({ documento_id: zUuid, despacho: zDespacho });

export async function despachar(ctx: CtxGed, entrada: unknown) {
  const e = zSimples.parse(entrada);
  await exigirDocumento(ctx, e.documento_id, "TRAMITAR");
  return ctx.db.$transaction((tx) => registrarTramite(tx, ctx, { documento_id: e.documento_id, tipo: "DESPACHO", despacho: e.despacho ?? undefined }));
}

export async function devolver(ctx: CtxGed, entrada: unknown) {
  const e = zSimples.parse(entrada);
  const { doc } = await exigirDocumento(ctx, e.documento_id, "TRAMITAR");
  if (!ehDestinatarioAtual(doc, ctx.usuario.id, ctx.setor_ids)) throw proibido("Somente quem recebeu o documento pode devolvê-lo.");
  return ctx.db.$transaction((tx) => registrarTramite(tx, ctx, { documento_id: e.documento_id, tipo: "DEVOLUCAO", despacho: e.despacho ?? undefined }));
}

export async function darCiencia(ctx: CtxGed, entrada: unknown) {
  const e = zSimples.parse(entrada);
  const { doc } = await exigirDocumento(ctx, e.documento_id, "TRAMITAR");
  if (!ehDestinatarioAtual(doc, ctx.usuario.id, ctx.setor_ids)) throw proibido("Somente o destinatário atual pode dar ciência.");
  return ctx.db.$transaction((tx) => registrarTramite(tx, ctx, { documento_id: e.documento_id, tipo: "CIENCIA", despacho: e.despacho ?? undefined }));
}

export async function arquivarDocumento(ctx: CtxGed, entrada: unknown) {
  const e = zSimples.parse(entrada);
  await exigirDocumento(ctx, e.documento_id, "TRAMITAR");
  return ctx.db.$transaction((tx) => registrarTramite(tx, ctx, { documento_id: e.documento_id, tipo: "ARQUIVAMENTO", despacho: e.despacho ?? undefined }));
}
