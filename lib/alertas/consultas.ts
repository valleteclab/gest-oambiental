import { prisma } from "../db";
import { auditar } from "../audit";

/** Alertas do usuário: não lidos primeiro, depois mais recentes. */
export async function listarMeusAlertas(usuarioId: string, opts: { skip?: number; take?: number; somenteNaoLidos?: boolean } = {}) {
  const where = { usuario_id: usuarioId, ...(opts.somenteNaoLidos ? { lido: false } : {}) };
  const [itens, total, naoLidos] = await Promise.all([
    prisma.alerta.findMany({ where, orderBy: [{ lido: "asc" }, { created_at: "desc" }], skip: opts.skip ?? 0, take: opts.take ?? 50 }),
    prisma.alerta.count({ where }),
    prisma.alerta.count({ where: { usuario_id: usuarioId, lido: false } }),
  ]);
  return { itens, total, naoLidos };
}

/** Marca um alerta como lido (só o dono). Retorna false se não pertence ao usuário. */
export async function marcarAlertaLido(id: string, usuarioId: string): Promise<boolean> {
  const r = await prisma.alerta.updateMany({ where: { id, usuario_id: usuarioId, lido: false }, data: { lido: true } });
  if (r.count > 0) await auditar({ usuario_id: usuarioId, acao: "ALERTA_LIDO", entidade: "alerta", entidade_id: id, depois: { lido: true } });
  if (r.count > 0) return true;
  return (await prisma.alerta.count({ where: { id, usuario_id: usuarioId } })) > 0;
}

export async function marcarTodosLidos(usuarioId: string): Promise<number> {
  const r = await prisma.alerta.updateMany({ where: { usuario_id: usuarioId, lido: false }, data: { lido: true } });
  if (r.count > 0) await auditar({ usuario_id: usuarioId, acao: "ALERTA_LIDO_TODOS", entidade: "alerta", entidade_id: null, depois: { quantidade: r.count } });
  return r.count;
}

/** Link interno da referência de um alerta. */
export function linkAlerta(a: { referencia_tipo: string; referencia_id: string }, processoId?: string | null): string {
  if (a.referencia_tipo === "PROCESSO") return `/processos/${a.referencia_id}`;
  if (a.referencia_tipo === "ALERTA_DESMATAMENTO") return `/monitoramento/${a.referencia_id}`;
  if (a.referencia_tipo === "MONITORAMENTO") return `/monitoramento?status=NOVO&de=`;
  if (processoId) return `/processos/${processoId}`;
  if (a.referencia_tipo === "DOCUMENTO") return `/documentos`;
  if (a.referencia_tipo === "NOTIFICACAO") return `/fiscalizacao`;
  return `/prazos`;
}
