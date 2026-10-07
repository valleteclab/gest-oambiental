// Canal de WhatsApp do cliente para as notificações do GED (somente ENVIO): um CanalAtendimento da organização com
// config.somente_envio="true" (a ingestão do agente de denúncias ignora esses canais e NENHUM webhook é registrado no provedor),
// ligado em GedConfig.canal_whatsapp_id. Segredos cifrados exatamente como em lib/canais (montarConfig). Provedores da fase 1:
// Evolution API e Z-API. Somente GED_ADMIN. Nunca devolve segredo (só os nomes dos definidos).
import type { Prisma, TipoCanal } from "@prisma/client";
import { z } from "zod";
import { invalido } from "@/lib/http";
import { CAMPOS_CANAL, comRitmo, envioSimulado, montarConfig, montarRuntime, novoSegredoWebhook, provedor, ROTULO_TIPO_CANAL } from "@/lib/canais";
import { baseEvolution } from "@/lib/canais/evolution";
import { chamarJson } from "@/lib/canais/http";
import type { CanalRuntime } from "@/lib/canais/tipos";
import { auditarGed } from "../auditoria";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { telefoneConfirmadoDoUsuario } from "../notificar/preferencias";
import { linhaEnviadoEm } from "../templates";
import { NOME_MODULO_GED } from "../tipos";
import { exigirAdmin } from "./membros";

export const TIPOS_CANAL_GED: readonly TipoCanal[] = ["WHATSAPP_EVOLUTION", "WHATSAPP_ZAPI"];
const OBRIGATORIOS: Record<string, string[]> = { WHATSAPP_EVOLUTION: ["instance_name"], WHATSAPP_ZAPI: ["instance_id"] };

export type CanalGedView = {
  id: string; tipo: TipoCanal; rotulo_tipo: string; nome: string; ativo: boolean; status_conexao: string | null;
  config: Record<string, string>; segredos_definidos: string[]; vinculado: boolean;
};
export type ConfigCanalGed = {
  canais: CanalGedView[];
  vinculado_id: string | null;
  simulado: boolean;
  tipos: { id: TipoCanal; rotulo: string; campos: (typeof CAMPOS_CANAL)[TipoCanal] }[];
};

const SOMENTE_ENVIO = { path: ["somente_envio"], equals: "true" } as const;

async function canalDaOrg(ctx: CtxGed, id: string) {
  const c = await ctx.db.canalAtendimento.findFirst({ where: { id, organizacao_id: ctx.organizacao_id, config: SOMENTE_ENVIO, tipo: { in: [...TIPOS_CANAL_GED] } } });
  return exigirEncontrado(c, "Canal não encontrado.");
}

async function idVinculado(ctx: CtxGed): Promise<string | null> {
  return (await ctx.db.gedConfig.findFirst({ select: { canal_whatsapp_id: true } }))?.canal_whatsapp_id ?? null;
}

export async function obterConfigCanal(ctx: CtxGed): Promise<ConfigCanalGed> {
  exigirAdmin(ctx);
  const [canais, vinculado] = await Promise.all([
    ctx.db.canalAtendimento.findMany({ where: { organizacao_id: ctx.organizacao_id, config: SOMENTE_ENVIO, tipo: { in: [...TIPOS_CANAL_GED] } }, orderBy: { nome: "asc" } }),
    idVinculado(ctx),
  ]);
  return {
    vinculado_id: vinculado,
    simulado: envioSimulado(),
    tipos: TIPOS_CANAL_GED.map((t) => ({ id: t, rotulo: ROTULO_TIPO_CANAL[t], campos: CAMPOS_CANAL[t] })),
    canais: canais.map((c) => {
      const rt = montarRuntime(c);
      const { somente_envio: _se, ...publico } = rt.config;
      void _se;
      return { id: c.id, tipo: c.tipo, rotulo_tipo: ROTULO_TIPO_CANAL[c.tipo], nome: c.nome, ativo: c.ativo, status_conexao: c.status_conexao, config: publico, segredos_definidos: Object.keys(rt.segredos), vinculado: c.id === vinculado };
    }),
  };
}

export const zCanalGed = z.object({
  id: z.string().uuid().optional().nullable(),
  tipo: z.enum(["WHATSAPP_EVOLUTION", "WHATSAPP_ZAPI"]),
  nome: z.string().trim().min(3, "Informe o nome do canal.").max(120),
  publicos: z.record(z.string(), z.string().trim().max(500)).default({}),
  segredos: z.record(z.string(), z.string().trim().max(2000)).default({}),
});

async function vincular(ctx: CtxGed, tx: Prisma.TransactionClient | CtxGed["db"], canalId: string | null) {
  // GedConfig é 1 por cliente: cria se ainda não existe (o escopo injeta organizacao_id)
  await (tx as CtxGed["db"]).gedConfig.upsert({
    where: { organizacao_id: ctx.organizacao_id },
    create: { canal_whatsapp_id: canalId } as Prisma.GedConfigUncheckedCreateInput,
    update: { canal_whatsapp_id: canalId },
  });
}

/** Cria (ou atualiza) o canal de envio do cliente e o vincula às notificações. Segredos não reenviados são mantidos. */
export async function salvarCanal(ctx: CtxGed, entrada: unknown): Promise<{ id: string }> {
  exigirAdmin(ctx);
  const d = zCanalGed.parse(entrada);
  for (const k of OBRIGATORIOS[d.tipo] ?? []) if (!d.publicos[k]) throw invalido(`Informe ${CAMPOS_CANAL[d.tipo].publicos.find((c) => c.k === k)?.rotulo ?? k}.`, { campo: k });

  if (d.id) {
    const antes = await canalDaOrg(ctx, d.id);
    if (antes.tipo !== d.tipo) throw invalido("Não é possível trocar o tipo de um canal existente; crie outro.");
    const rt = montarRuntime(antes);
    const { somente_envio: _se, ...publicosAtuais } = rt.config;
    void _se;
    const cfg = montarConfig(antes.tipo, { ...publicosAtuais, ...d.publicos }, d.segredos, rt) as Record<string, unknown>;
    await ctx.db.$transaction(async (tx) => {
      await tx.canalAtendimento.updateMany({ where: { id: antes.id, organizacao_id: ctx.organizacao_id }, data: { nome: d.nome, config: { ...cfg, somente_envio: "true" } as Prisma.InputJsonValue } });
      await auditarGed(ctx, { acao: "GED_CANAL_ATUALIZADO", entidade: "ged_canal", entidade_id: antes.id, antes: { nome: antes.nome, config: publicosAtuais }, depois: { nome: d.nome, config: d.publicos, segredos_alterados: Object.keys(d.segredos).filter((k) => d.segredos[k]) } }, tx as never);
      await vincular(ctx, tx as never, antes.id);
    });
    return { id: antes.id };
  }

  const cfg = montarConfig(d.tipo, d.publicos, d.segredos) as Record<string, unknown>;
  return ctx.db.$transaction(async (tx) => {
    const c = await tx.canalAtendimento.create({
      data: {
        organizacao_id: ctx.organizacao_id, municipio_id: null, tipo: d.tipo, nome: d.nome, config: { ...cfg, somente_envio: "true" } as Prisma.InputJsonValue,
        webhook_secret: novoSegredoWebhook(), created_by: ctx.usuario.id,
      },
    });
    await auditarGed(ctx, { acao: "GED_CANAL_CRIADO", entidade: "ged_canal", entidade_id: c.id, depois: { tipo: c.tipo, nome: c.nome, config: d.publicos } }, tx as never);
    await vincular(ctx, tx as never, c.id);
    return { id: c.id };
  });
}

/** Seleciona entre os canais de ENVIO já existentes do cliente (somente_envio); canais do agente de denúncias não são oferecidos. */
export async function vincularCanal(ctx: CtxGed, canalId: string): Promise<void> {
  exigirAdmin(ctx);
  const c = await canalDaOrg(ctx, canalId);
  const antes = await idVinculado(ctx);
  await ctx.db.$transaction(async (tx) => {
    await vincular(ctx, tx as never, c.id);
    await auditarGed(ctx, { acao: "GED_CANAL_VINCULADO", entidade: "ged_canal", entidade_id: c.id, antes: { canal_id: antes }, depois: { canal_id: c.id, nome: c.nome } }, tx as never);
  });
}

export async function desvincularCanal(ctx: CtxGed): Promise<void> {
  exigirAdmin(ctx);
  const antes = await idVinculado(ctx);
  if (!antes) return;
  await ctx.db.$transaction(async (tx) => {
    await vincular(ctx, tx as never, null);
    await auditarGed(ctx, { acao: "GED_CANAL_DESVINCULADO", entidade: "ged_canal", entidade_id: antes, antes: { canal_id: antes } }, tx as never);
  });
}

export async function definirCanalAtivo(ctx: CtxGed, canalId: string, ativo: boolean): Promise<void> {
  exigirAdmin(ctx);
  const c = await canalDaOrg(ctx, canalId);
  if (c.ativo === ativo) return;
  await ctx.db.$transaction(async (tx) => {
    await tx.canalAtendimento.updateMany({ where: { id: c.id, organizacao_id: ctx.organizacao_id }, data: { ativo } });
    await auditarGed(ctx, { acao: ativo ? "GED_CANAL_ATIVADO" : "GED_CANAL_DESATIVADO", entidade: "ged_canal", entidade_id: c.id, antes: { ativo: c.ativo }, depois: { ativo } }, tx as never);
  });
}

// ───────────── Pareamento (QR) sem registrar webhook ─────────────

/** Evolution: cria a instância (se preciso) e devolve o QR – SEM chamar /webhook/set (canal só de envio). Z-API: usa o connect do provedor. */
export async function parear(rt: CanalRuntime): Promise<{ estado: string; qrcode?: string | null; mensagem?: string }> {
  if (rt.tipo === "WHATSAPP_ZAPI") return provedor(rt.tipo).connect!(rt, "");
  if (rt.tipo !== "WHATSAPP_EVOLUTION") throw invalido("Este tipo de canal não usa QR Code.");
  const base = baseEvolution(rt);
  const chave = rt.segredos.api_key || process.env.EVOLUTION_API_KEY || "";
  const nome = rt.config.instance_name;
  if (!base) throw invalido("EVOLUTION_BASE_URL não configurada no servidor.");
  if (!chave) throw invalido("EVOLUTION_API_KEY não configurada (informe a API key do canal ou no servidor).");
  if (!nome) throw invalido("Informe o nome da instância.");
  const h = { apikey: chave };
  const inst = encodeURIComponent(nome);
  const existentes = await chamarJson<{ name?: string; instance?: { instanceName?: string } }[]>(`${base}/instance/fetchInstances?instanceName=${inst}`, { headers: h }).catch(() => []);
  const existe = Array.isArray(existentes) && existentes.some((i) => (i.name ?? i.instance?.instanceName) === nome);
  if (!existe) await chamarJson(`${base}/instance/create`, { headers: h, json: { instanceName: nome, integration: "WHATSAPP-BAILEYS", qrcode: true } });
  const st = await provedor(rt.tipo).status!(rt);
  if (st.estado === "open") return { estado: "open", mensagem: "Instância já conectada ao WhatsApp." };
  const qr = await chamarJson<{ base64?: string; pairingCode?: string }>(`${base}/instance/connect/${inst}`, { headers: h });
  return { estado: st.estado, qrcode: qr.base64 ?? null, mensagem: qr.pairingCode ? `Código de pareamento: ${qr.pairingCode}` : undefined };
}

export async function conectarCanal(ctx: CtxGed, canalId: string) {
  exigirAdmin(ctx);
  const c = await canalDaOrg(ctx, canalId);
  const r = await parear(montarRuntime(c));
  await ctx.db.$transaction(async (tx) => {
    await tx.canalAtendimento.updateMany({ where: { id: c.id, organizacao_id: ctx.organizacao_id }, data: { status_conexao: r.estado } });
    await auditarGed(ctx, { acao: "GED_CANAL_CONECTADO", entidade: "ged_canal", entidade_id: c.id, depois: { estado: r.estado } }, tx as never);
  });
  return r;
}

export async function statusCanal(ctx: CtxGed, canalId: string) {
  exigirAdmin(ctx);
  const c = await canalDaOrg(ctx, canalId);
  const p = provedor(c.tipo);
  const r = p.status ? await p.status(montarRuntime(c)) : { estado: c.ativo ? "ativo" : "inativo" };
  await ctx.db.canalAtendimento.updateMany({ where: { id: c.id, organizacao_id: ctx.organizacao_id }, data: { status_conexao: r.estado } });
  return r;
}

/** Envia uma mensagem de teste ao telefone CONFIRMADO do próprio administrador (nunca a número digitado na hora). */
export async function testarCanal(ctx: CtxGed, canalId: string): Promise<{ simulado: boolean }> {
  exigirAdmin(ctx);
  const c = await canalDaOrg(ctx, canalId);
  const telefone = await telefoneConfirmadoDoUsuario(ctx);
  if (!telefone) throw invalido("Cadastre e confirme o seu telefone em Minhas notificações antes de testar o canal.");
  const rt = montarRuntime(c);
  const prov = provedor(rt.tipo);
  const texto = `✅ Teste do canal de notificações do ${NOME_MODULO_GED} – ${ctx.organizacao.nome}.\n${linhaEnviadoEm(new Date())}`;
  let simulado = false;
  if (envioSimulado()) {
    simulado = true;
    console.log(`[ged-canal][simulado] teste ${rt.tipo} → ${ctx.usuario.id}`);
  } else {
    await comRitmo(rt, () => prov.sendText(rt, telefone, texto));
  }
  await auditarGed(ctx, { acao: "GED_CANAL_TESTADO", entidade: "ged_canal", entidade_id: c.id, depois: { simulado } });
  return { simulado };
}
