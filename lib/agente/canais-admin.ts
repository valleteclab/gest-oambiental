import "server-only";
import type { TipoCanal } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { auditar } from "../audit";
import { cifrar } from "../crypto";
import { invalido, naoEncontrado } from "../http";
import type { UsuarioSessao } from "../rbac";
import { exigirMunicipioDoAdmin, organizacaoDoAdmin } from "../admin/escopo";
import { CAMPOS_CANAL, envioSimulado, montarConfig, montarRuntime, novoSegredoWebhook, provedor, urlWebhook } from "../canais";
import { gerarSegredo } from "../canais/contato";
import { normalizarTelefone } from "../canais/telefone";
import { ehEmail } from "../canais/contato";

// Administração dos canais de atendimento (/admin/canais) – sempre restrita à organização do ADMIN.

export const TIPOS_CANAL: TipoCanal[] = ["WHATSAPP_EVOLUTION", "WHATSAPP_ZAPI", "WHATSAPP_CHATWOOT", "EMAIL", "WEBCHAT"];

export const CanalSchema = z.object({
  tipo: z.enum(["WHATSAPP_ZAPI", "WHATSAPP_EVOLUTION", "WHATSAPP_CHATWOOT", "WEBCHAT", "EMAIL"]),
  nome: z.string().trim().min(3, "Informe o nome do canal.").max(120),
  municipio_id: z.string().uuid().nullable().optional(),
  /** Alternativa ao id (automação/API): sigla do município da organização. */
  municipio_sigla: z.string().trim().max(5).nullable().optional(),
  publicos: z.record(z.string(), z.string().trim().max(500)).default({}),
  segredos: z.record(z.string(), z.string().trim().max(2000)).default({}),
});
export type CanalInput = z.infer<typeof CanalSchema>;

export async function listarCanais(u: UsuarioSessao) {
  const org = organizacaoDoAdmin(u);
  const canais = await prisma.canalAtendimento.findMany({ where: { organizacao_id: org }, orderBy: [{ tipo: "asc" }, { nome: "asc" }], include: { municipio: { select: { nome: true, sigla: true } }, _count: { select: { conversas: true } } } });
  return canais.map((c) => {
    const rt = montarRuntime(c);
    return {
      id: c.id, tipo: c.tipo, nome: c.nome, ativo: c.ativo, status_conexao: c.status_conexao, ultimo_evento_em: c.ultimo_evento_em, municipio: c.municipio, municipio_id: c.municipio_id,
      conversas: c._count.conversas, config: rt.config, segredos_definidos: Object.keys(rt.segredos),
      webhook_url: c.tipo === "WEBCHAT" ? null : urlWebhook(rt), webhook_url_sem_token: c.tipo === "WEBCHAT" ? null : urlWebhook(rt, false), webhook_secret: rt.webhookSecret,
    };
  });
}

async function canalDaOrg(u: UsuarioSessao, id: string) {
  const c = await prisma.canalAtendimento.findFirst({ where: { id, organizacao_id: organizacaoDoAdmin(u) } });
  if (!c) throw naoEncontrado("Canal não encontrado.");
  return c;
}

export async function criarCanal(u: UsuarioSessao, entrada: CanalInput) {
  const d = CanalSchema.parse(entrada);
  const org = organizacaoDoAdmin(u);
  if (!d.municipio_id && d.municipio_sigla) {
    const m = await prisma.municipio.findFirst({ where: { organizacao_id: org, sigla: d.municipio_sigla.toUpperCase() }, select: { id: true } });
    if (!m) throw invalido("Município não encontrado.", { campo: "municipio_sigla" });
    d.municipio_id = m.id;
  }
  await exigirMunicipioDoAdmin(u, d.municipio_id);
  if (d.tipo === "WEBCHAT" && !d.municipio_id) throw invalido("O chat do site é por município.", { campo: "municipio_id" });
  if (d.tipo === "WEBCHAT" && (await prisma.canalAtendimento.count({ where: { tipo: "WEBCHAT", municipio_id: d.municipio_id } }))) throw invalido("Este município já tem chat do site.");
  const obrig = { WHATSAPP_EVOLUTION: ["instance_name"], WHATSAPP_ZAPI: ["instance_id"], WHATSAPP_CHATWOOT: ["url", "account_id"], EMAIL: [], WEBCHAT: [] }[d.tipo];
  for (const k of obrig) if (!d.publicos[k]) throw invalido(`Informe ${CAMPOS_CANAL[d.tipo].publicos.find((c) => c.k === k)?.rotulo ?? k}.`, { campo: k });
  const c = await prisma.canalAtendimento.create({
    data: { organizacao_id: org, municipio_id: d.municipio_id ?? null, tipo: d.tipo, nome: d.nome, config: montarConfig(d.tipo, d.publicos, d.segredos), webhook_secret: novoSegredoWebhook(), created_by: u.id },
  });
  await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "canal_atendimento", entidade_id: c.id, depois: { tipo: c.tipo, nome: c.nome, municipio_id: c.municipio_id, config: montarRuntime(c).config } });
  return c;
}

export async function atualizarCanal(u: UsuarioSessao, id: string, entrada: Partial<CanalInput> & { ativo?: boolean }) {
  const antes = await canalDaOrg(u, id);
  const rt = montarRuntime(antes);
  if (entrada.municipio_id !== undefined) await exigirMunicipioDoAdmin(u, entrada.municipio_id);
  const c = await prisma.canalAtendimento.update({
    where: { id },
    data: {
      ...(entrada.nome ? { nome: entrada.nome.trim().slice(0, 120) } : {}),
      ...(entrada.municipio_id !== undefined && antes.tipo !== "WEBCHAT" ? { municipio_id: entrada.municipio_id } : {}),
      ...(entrada.ativo !== undefined ? { ativo: entrada.ativo } : {}),
      ...(entrada.publicos || entrada.segredos ? { config: montarConfig(antes.tipo, { ...rt.config, ...(entrada.publicos ?? {}) }, entrada.segredos ?? {}, rt) } : {}),
    },
  });
  await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "canal_atendimento", entidade_id: id, antes: { nome: antes.nome, ativo: antes.ativo, config: rt.config }, depois: { nome: c.nome, ativo: c.ativo, config: montarRuntime(c).config, segredos_alterados: Object.keys(entrada.segredos ?? {}).filter((k) => entrada.segredos?.[k]) } });
  return c;
}

export async function novoSegredo(u: UsuarioSessao, id: string) {
  await canalDaOrg(u, id);
  await prisma.canalAtendimento.update({ where: { id }, data: { webhook_secret: cifrar(gerarSegredo()) } });
  await auditar({ usuario_id: u.id, acao: "ROTACIONAR_SEGREDO", entidade: "canal_atendimento", entidade_id: id });
}

/** Evolution/Z-API: cria a instância (Evolution), configura o webhook e devolve o QR Code. */
export async function conectarCanal(u: UsuarioSessao, id: string) {
  const c = await canalDaOrg(u, id);
  const rt = montarRuntime(c);
  const p = provedor(c.tipo);
  if (!p.connect) throw invalido("Este tipo de canal não usa QR Code.");
  const r = await p.connect(rt, urlWebhook(rt, false));
  await prisma.canalAtendimento.update({ where: { id }, data: { status_conexao: r.estado } });
  await auditar({ usuario_id: u.id, acao: "CONECTAR_CANAL", entidade: "canal_atendimento", entidade_id: id, depois: { estado: r.estado } });
  return r;
}

export async function statusCanal(u: UsuarioSessao, id: string) {
  const c = await canalDaOrg(u, id);
  const p = provedor(c.tipo);
  if (!p.status) return { estado: c.ativo ? "ativo" : "inativo" };
  const r = await p.status(montarRuntime(c));
  await prisma.canalAtendimento.update({ where: { id }, data: { status_conexao: r.estado } });
  return r;
}

/** "Enviar mensagem de teste" para um número/e-mail (não cria conversa). */
export async function testarCanal(u: UsuarioSessao, id: string, destino: string) {
  const c = await canalDaOrg(u, id);
  if (c.tipo === "WEBCHAT") throw invalido("O chat do site não envia mensagens ativas.");
  const rt = montarRuntime(c);
  let para = destino.trim();
  if (c.tipo === "EMAIL") {
    if (!ehEmail(para)) throw invalido("Informe um e-mail válido.", { campo: "destino" });
  } else if (c.tipo !== "WHATSAPP_CHATWOOT") {
    const n = normalizarTelefone(para);
    if (!n) throw invalido("Informe um telefone válido com DDD.", { campo: "destino" });
    para = n;
  }
  const texto = "✅ Mensagem de teste do LicenciaGov – canal de denúncias ambientais configurado.";
  if (envioSimulado()) {
    console.log(`[agente][simulado] teste ${c.tipo} → ${para}`);
    return { simulado: true };
  }
  await provedor(c.tipo).sendText(rt, para, texto, { assunto: "Teste do canal de denúncias" });
  await auditar({ usuario_id: u.id, acao: "TESTAR_CANAL", entidade: "canal_atendimento", entidade_id: id });
  return { simulado: false };
}

/** Consumo de IA por mês (organização do admin). */
export async function usoIaPorMes(u: UsuarioSessao, meses = 6) {
  const org = organizacaoDoAdmin(u);
  const desde = new Date(new Date().getFullYear(), new Date().getMonth() - (meses - 1), 1);
  const linhas = await prisma.$queryRaw<{ mes: string; modelo: string; chamadas: bigint; tokens_in: bigint; tokens_out: bigint; custo: string }[]>`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes, modelo, count(*)::bigint AS chamadas,
           COALESCE(sum(tokens_in),0)::bigint AS tokens_in, COALESCE(sum(tokens_out),0)::bigint AS tokens_out, COALESCE(sum(custo_estimado),0)::text AS custo
      FROM uso_ia WHERE organizacao_id = ${org}::uuid AND created_at >= ${desde}
     GROUP BY 1, 2 ORDER BY 1 DESC, 2`;
  return linhas.map((l) => ({ mes: l.mes, modelo: l.modelo, chamadas: Number(l.chamadas), tokens_in: Number(l.tokens_in), tokens_out: Number(l.tokens_out), custo: Number(l.custo) }));
}
