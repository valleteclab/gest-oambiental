// Registro de eventos do compartilhamento (transparência para quem compartilhou). Sem dado pessoal completo: IP truncado,
// user-agent resumido, telefone nunca. Falha de log NUNCA derruba a requisição.
import type { Prisma } from "@prisma/client";
import type { GedDb, GedTx } from "../db";
import { resumirUserAgent, truncarIp, type TipoEventoCompartilhamento } from "./regras";

export type MetaEvento = { ip?: string | null; user_agent?: string | null };

export function dadosEvento(organizacaoId: string, linkId: string, tipo: TipoEventoCompartilhamento, meta: MetaEvento = {}, extra: { documento_id?: string | null; detalhe?: string | null } = {}): Prisma.GedCompartilhamentoEventoUncheckedCreateInput {
  return {
    organizacao_id: organizacaoId,
    compartilhamento_id: linkId,
    tipo,
    documento_id: extra.documento_id ?? null,
    ip: truncarIp(meta.ip),
    user_agent: resumirUserAgent(meta.user_agent),
    detalhe: extra.detalhe ? extra.detalhe.slice(0, 300) : null,
  };
}

export async function registrarEventoCompartilhamento(db: GedDb | GedTx, organizacaoId: string, linkId: string, tipo: TipoEventoCompartilhamento, meta: MetaEvento = {}, extra: { documento_id?: string | null; detalhe?: string | null } = {}): Promise<void> {
  try {
    await db.gedCompartilhamentoEvento.create({ data: dadosEvento(organizacaoId, linkId, tipo, meta, extra) });
  } catch (e) {
    console.error("[ged-compartilhamento] falha ao registrar evento", tipo, e instanceof Error ? e.message : e);
  }
}
