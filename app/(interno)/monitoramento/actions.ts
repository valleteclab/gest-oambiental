"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ErroApi } from "@/lib/http";
import { podeVerMunicipio } from "@/lib/rbac";
import { codigoIbgeReal } from "@/lib/geo/uf";
import { podeSincronizar } from "@/lib/monitoramento/regras";
import { abrirFiscalizacao, alterarStatusAlerta } from "@/lib/monitoramento/servico";
import { sincronizarEmSegundoPlano } from "@/lib/monitoramento/sync";

export type EstadoAcao = { erro?: string; ok?: string; fiscalizacao_id?: string } | undefined;

const msg = (e: unknown) => (e instanceof ErroApi ? e.message : "Não foi possível concluir a operação.");

/** "Sincronizar agora" (ADMIN/técnicos): dispara em segundo plano; a tela acompanha pela última sincronização. */
export async function acaoSincronizar(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  const id = String(form.get("municipio_id") ?? "");
  if (!z.string().uuid().safeParse(id).success || !podeVerMunicipio(u, id)) return { erro: "Selecione um município do seu escopo." };
  if (!podeSincronizar(u, id)) return { erro: "Seu perfil não pode sincronizar o monitoramento." };
  const m = await prisma.municipio.findUnique({ where: { id }, select: { nome: true, codigo_ibge: true } });
  if (!m) return { erro: "Município não encontrado." };
  if (!codigoIbgeReal(m.codigo_ibge)) return { erro: `${m.nome} tem código IBGE fictício (demonstração): não há alertas do INPE para sincronizar.` };
  const emCurso = await prisma.monitoramentoSync.findFirst({ where: { municipio_id: id, status: "EXECUTANDO", iniciado_em: { gte: new Date(Date.now() - 45 * 60_000) } }, select: { id: true } });
  if (emCurso) return { erro: "Já existe uma sincronização em andamento para este município." };
  await auditar({ usuario_id: u.id, acao: "MONITORAMENTO_SINCRONIZAR_SOLICITADO", entidade: "municipio", entidade_id: id, depois: { origem: "manual" } });
  sincronizarEmSegundoPlano(id, { origem: "manual", usuario_id: u.id });
  revalidatePath("/monitoramento");
  return { ok: `Sincronização de ${m.nome} iniciada. Atualize a página em alguns instantes.` };
}

const StatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["NOVO", "EM_ANALISE", "AUTORIZADO", "IRREGULAR", "DESCARTADO"]),
  observacao: z.string().trim().max(3000).optional().nullable(),
  documento_id: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
});

export async function acaoAlterarStatus(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  const r = StatusSchema.safeParse({ id: form.get("id"), status: form.get("status"), observacao: form.get("observacao"), documento_id: form.get("documento_id") || null });
  if (!r.success) return { erro: r.error.issues[0]?.message ?? "Dados inválidos." };
  try {
    await alterarStatusAlerta(u, r.data.id, r.data);
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath(`/monitoramento/${r.data.id}`);
  revalidatePath("/monitoramento");
  return { ok: "Situação atualizada." };
}

export async function acaoAbrirFiscalizacao(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  const id = String(form.get("id") ?? "");
  if (!z.string().uuid().safeParse(id).success) return { erro: "Alerta inválido." };
  try {
    const r = await abrirFiscalizacao(u, id);
    revalidatePath(`/monitoramento/${id}`);
    return { ok: r.criada ? "Fiscalização agendada." : "O alerta já tem fiscalização.", fiscalizacao_id: r.fiscalizacao_id };
  } catch (e) {
    return { erro: msg(e) };
  }
}
