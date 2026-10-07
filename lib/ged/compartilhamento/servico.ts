// Compartilhamento externo – lado de QUEM COMPARTILHA (usuário do GED autenticado): criar, listar, detalhar e revogar links.
// Tudo via ctx.db (gedDb). O token (>= 32 bytes) é devolvido UMA vez, na criação; só o sha256 fica no banco. O WhatsApp do
// destinatário é cifrado e NUNCA é devolvido por esta camada (só mascarado). Regras de segurança em docs/ged.md §18.
import type { GedCompartilhamento, Prisma } from "@prisma/client";
import { cifrar, hashBusca } from "@/lib/crypto";
import { enviarEmail } from "@/lib/email";
import { ErroApi, invalido, proibido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import { baseUrlApp } from "../assinaturas/regras";
import { exigirEncontrado, naoEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { escHtml } from "../templates";
import { podeAdministrarGed, podeCompartilhar } from "../papeis";
import { exigirDocumento, exigirPasta } from "../permissoes";
import { carregarEscopoLink } from "./conteudo";
import { dadosEvento, registrarEventoCompartilhamento } from "./eventos";
import {
  calcularExpiracao, ROTULO_EVENTO_COMPARTILHAMENTO, ROTULO_MOTIVO_BLOQUEIO, ROTULO_STATUS_COMPARTILHAMENTO, exigeConfirmacaoRestrito, gerarToken, hashToken, MAX_ITENS_CONGELADOS, mascararWhatsapp,
  motivosBloqueio, normalizarPermissoes, normalizarWhatsapp, resolverValidadeDias, statusEfetivo, zCriarCompartilhamento, type EntradaCompartilhamento,
} from "./regras";
import { canalWhatsappDisponivel, enviarWhatsappGed, textoLink } from "./whatsapp";

const SEM_PERMISSAO = "Você não tem permissão para compartilhar documentos externamente.";

export type CompartilhamentoView = {
  id: string;
  recurso_tipo: "DOCUMENTO" | "PASTA";
  recurso_id: string | null;
  recurso_rotulo: string;
  destinatario_nome: string | null;
  destinatario_mascarado: string;
  criado_por_id: string;
  criado_por_nome: string;
  created_at: Date;
  expira_em: Date;
  status: "ATIVO" | "REVOGADO" | "EXPIRADO";
  status_rotulo: string;
  pode_visualizar: boolean;
  pode_baixar: boolean;
  pode_zip: boolean;
  downloads: number;
  limite_downloads: number | null;
  congelado: boolean;
  itens_congelados: number;
  primeiro_acesso_em: Date | null;
  ultimo_acesso_em: Date | null;
  revogado_em: Date | null;
  revogado_motivo: string | null;
  mensagem: string | null;
  notificar_primeiro_acesso: boolean;
  link_enviado_whatsapp_em: Date | null;
};

export type CompartilhamentoCriado = CompartilhamentoView & {
  /** Exibido UMA vez. Não é possível recuperar depois (só o hash fica guardado). */
  token: string;
  caminho: string;
  url: string;
  link_whatsapp: "NAO_SOLICITADO" | "ENVIADO" | "FALHOU";
  aviso_restrito: boolean;
};

const nomeUsuario = async (ctx: CtxGed, ids: string[]): Promise<Map<string, string>> => {
  const u = ids.length ? await ctx.db.usuario.findMany({ where: { id: { in: [...new Set(ids)] }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true } }) : [];
  return new Map(u.map((x) => [x.id, x.nome]));
};

function paraView(l: GedCompartilhamento, nomes: Map<string, string>, agora = new Date()): CompartilhamentoView {
  const status = statusEfetivo(l, agora);
  return {
    id: l.id,
    recurso_tipo: l.recurso_tipo,
    recurso_id: l.documento_id ?? l.pasta_id,
    recurso_rotulo: l.recurso_rotulo,
    destinatario_nome: l.destinatario_nome,
    destinatario_mascarado: l.destinatario_mascarado,
    criado_por_id: l.criado_por_id,
    criado_por_nome: nomes.get(l.criado_por_id) ?? "—",
    created_at: l.created_at,
    expira_em: l.expira_em,
    status,
    status_rotulo: ROTULO_STATUS_COMPARTILHAMENTO[status],
    pode_visualizar: l.pode_visualizar,
    pode_baixar: l.pode_baixar,
    pode_zip: l.pode_zip,
    downloads: l.downloads,
    limite_downloads: l.limite_downloads,
    congelado: l.congelado,
    itens_congelados: l.itens_congelados.length,
    primeiro_acesso_em: l.primeiro_acesso_em,
    ultimo_acesso_em: l.ultimo_acesso_em,
    revogado_em: l.revogado_em,
    revogado_motivo: l.revogado_motivo,
    mensagem: l.mensagem,
    notificar_primeiro_acesso: l.notificar_primeiro_acesso,
    link_enviado_whatsapp_em: l.link_enviado_whatsapp_em,
  };
}

// ───────────── Configuração do cliente ─────────────

export type ConfigCompartilhamento = { ativo: boolean; validade_padrao_dias: number; validade_max_dias: number; notificar_acesso: boolean };

export async function lerConfigCompartilhamento(ctx: Pick<CtxGed, "db">): Promise<ConfigCompartilhamento> {
  const c = await ctx.db.gedConfig.findFirst({ select: { compartilhamento_ativo: true, compartilhamento_validade_padrao_dias: true, compartilhamento_validade_max_dias: true, compartilhamento_notificar_acesso: true } });
  return {
    ativo: c?.compartilhamento_ativo ?? true,
    validade_padrao_dias: c?.compartilhamento_validade_padrao_dias ?? 7,
    validade_max_dias: Math.min(c?.compartilhamento_validade_max_dias ?? 30, 30),
    notificar_acesso: c?.compartilhamento_notificar_acesso ?? true,
  };
}

// ───────────── Pode compartilhar este recurso? ─────────────

/** Documento: VER + capacidade; Usuário ainda precisa ser o autor ou ter EDITAR. */
async function exigirDocumentoCompartilhavel(ctx: CtxGed, id: string) {
  const { doc, acoes } = await exigirDocumento(ctx, id, "VER");
  if (ctx.membro.papel === "GED_USUARIO" && doc.criado_por_id !== ctx.usuario.id && !acoes.includes("EDITAR")) throw proibido("Você pode compartilhar documentos que criou ou que pode editar.");
  return doc;
}
async function exigirPastaCompartilhavel(ctx: CtxGed, id: string) {
  const { pasta, acoes } = await exigirPasta(ctx, id, "VER");
  if (ctx.membro.papel === "GED_USUARIO" && !acoes.includes("EDITAR") && !acoes.includes("ADMINISTRAR")) throw proibido("Você precisa de permissão de edição na pasta para compartilhá-la.");
  return pasta;
}

/** Para a UI: mostra o botão "Compartilhar"? (barato: só papel + permissão no recurso; sem lançar). */
export async function podeCompartilharRecurso(ctx: CtxGed, alvo: { tipo: "documento" | "pasta"; id: string }): Promise<boolean> {
  if (!podeCompartilhar(ctx)) return false;
  try {
    if (alvo.tipo === "documento") await exigirDocumentoCompartilhavel(ctx, alvo.id);
    else await exigirPastaCompartilhavel(ctx, alvo.id);
    return true;
  } catch {
    return false;
  }
}

// ───────────── Preparação da tela "Compartilhar" ─────────────

export type PreparoCompartilhamento = {
  tipo: "documento" | "pasta";
  id: string;
  rotulo: string;
  /** Motivo (texto) pelo qual NÃO é possível compartilhar; null = pode. */
  bloqueio: string | null;
  exige_confirmacao: boolean;
  canal: { ok: boolean; motivo: string | null };
  config: ConfigCompartilhamento;
  documentos_agora: number | null;
};

/** Dados para a tela de criação: o que será compartilhado, se há impedimento e o que a pessoa precisa confirmar. */
export async function prepararCompartilhamento(ctx: CtxGed, alvo: { tipo: "documento" | "pasta"; id: string }): Promise<PreparoCompartilhamento> {
  if (!podeCompartilhar(ctx)) throw proibido(SEM_PERMISSAO);
  const [config, canal] = await Promise.all([lerConfigCompartilhamento(ctx), canalWhatsappDisponivel(ctx.db, ctx.organizacao_id)]);
  const base = { tipo: alvo.tipo, id: alvo.id, config, canal: { ok: canal.ok, motivo: canal.ok ? null : canal.motivo } };
  if (!config.ativo) return { ...base, rotulo: "", bloqueio: "O compartilhamento externo está desativado para esta organização.", exige_confirmacao: false, documentos_agora: null };
  if (alvo.tipo === "documento") {
    await exigirDocumentoCompartilhavel(ctx, alvo.id);
    const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: alvo.id }, select: { titulo: true, numero: true, sensibilidade: true, contem_dados_pessoais: true, anonimizacao_status: true, documento_original_id: true, status: true, excluido_em: true } }));
    const m = motivosBloqueio(d);
    return { ...base, rotulo: d.titulo, bloqueio: m.length ? `Este documento não pode ser compartilhado externamente: ${ROTULO_MOTIVO_BLOQUEIO[m[0]]}.` : null, exige_confirmacao: exigeConfirmacaoRestrito(d.sensibilidade), documentos_agora: 1 };
  }
  await exigirPastaCompartilhavel(ctx, alvo.id);
  const p = exigirEncontrado(await ctx.db.gedPasta.findFirst({ where: { id: alvo.id, excluido_em: null }, select: { id: true, nome: true } }), "Pasta não encontrada.");
  const esc = await carregarEscopoLink({ id: "00000000-0000-4000-8000-000000000000", organizacao_id: ctx.organizacao_id, criado_por_id: ctx.usuario.id, recurso_tipo: "PASTA", documento_id: null, pasta_id: p.id, congelado: false, itens_congelados: [] });
  const total = esc ? await ctx.db.gedDocumento.count({ where: esc.docWhere }) : 0;
  return { ...base, rotulo: p.nome, bloqueio: total === 0 ? "A pasta não tem documentos que possam ser compartilhados externamente (sigilosos, com dados pessoais, arquivados ou sem permissão ficam de fora)." : null, exige_confirmacao: true, documentos_agora: total };
}

// ───────────── Criar ─────────────

const naoCompartilhavel = (msg: string, code = "NAO_COMPARTILHAVEL") => new ErroApi(422, code, msg);

export async function criarCompartilhamento(ctx: CtxGed, entrada: unknown, opc: { agora?: Date } = {}): Promise<CompartilhamentoCriado> {
  if (!podeCompartilhar(ctx)) throw proibido(SEM_PERMISSAO);
  const e: EntradaCompartilhamento = zCriarCompartilhamento.parse(entrada);
  const agora = opc.agora ?? new Date();
  const cfg = await lerConfigCompartilhamento(ctx);
  if (!cfg.ativo) throw proibido("O compartilhamento externo está desativado para esta organização.");

  const telefone = normalizarWhatsapp(e.whatsapp);
  if (!telefone) throw invalido("Informe um WhatsApp válido com DDD (celular), por exemplo (75) 99999-8888.", { campo: "whatsapp" });
  const permissoes = normalizarPermissoes({ pode_visualizar: e.pode_visualizar, pode_baixar: e.pode_baixar, pode_zip: e.pode_zip }, e.recurso.tipo === "pasta" ? "PASTA" : "DOCUMENTO");
  if ("erro" in permissoes) throw invalido(permissoes.erro);

  const dias = resolverValidadeDias(e.validade_dias, { padrao: cfg.validade_padrao_dias, maximo: cfg.validade_max_dias });
  if (e.validade_dias && e.validade_dias > cfg.validade_max_dias) throw invalido(`A validade máxima configurada para a organização é de ${cfg.validade_max_dias} dia(s).`, { campo: "validade_dias" });

  let documento_id: string | null = null;
  let pasta_id: string | null = null;
  let rotulo = "";
  let congelados: string[] = [];
  let avisoRestrito = false;

  if (e.recurso.tipo === "documento") {
    await exigirDocumentoCompartilhavel(ctx, e.recurso.id);
    const d = exigirEncontrado(
      await ctx.db.gedDocumento.findUnique({ where: { id: e.recurso.id }, select: { id: true, titulo: true, numero: true, sensibilidade: true, contem_dados_pessoais: true, anonimizacao_status: true, documento_original_id: true, status: true, excluido_em: true, versao_atual_id: true } }),
      "Documento não encontrado.",
    );
    const motivos = motivosBloqueio(d);
    if (motivos.length) throw naoCompartilhavel(`Este documento não pode ser compartilhado externamente: ${ROTULO_MOTIVO_BLOQUEIO[motivos[0]]}.`, motivos[0] === "SIGILOSO" ? "SIGILOSO_NAO_COMPARTILHAVEL" : "NAO_COMPARTILHAVEL");
    if (!d.versao_atual_id) throw naoCompartilhavel("O documento ainda não tem arquivo para compartilhar.");
    avisoRestrito = exigeConfirmacaoRestrito(d.sensibilidade);
    documento_id = d.id;
    rotulo = d.titulo;
  } else {
    await exigirPastaCompartilhavel(ctx, e.recurso.id);
    const p = exigirEncontrado(await ctx.db.gedPasta.findFirst({ where: { id: e.recurso.id, excluido_em: null }, select: { id: true, nome: true } }), "Pasta não encontrada.");
    pasta_id = p.id;
    rotulo = p.nome;
    // Quantos documentos o criador (este usuário) compartilharia hoje? Usa o MESMO cálculo do acesso do destinatário.
    const provisorio = { id: "00000000-0000-4000-8000-000000000000", organizacao_id: ctx.organizacao_id, criado_por_id: ctx.usuario.id, recurso_tipo: "PASTA" as const, documento_id: null, pasta_id: p.id, congelado: false, itens_congelados: [] };
    const esc = await carregarEscopoLink(provisorio);
    if (!esc) throw proibido(SEM_PERMISSAO);
    const total = await ctx.db.gedDocumento.count({ where: esc.docWhere });
    if (total === 0) throw naoCompartilhavel("A pasta não tem documentos que possam ser compartilhados externamente (sigilosos, com dados pessoais, arquivados ou sem permissão ficam de fora).", "PASTA_SEM_DOCUMENTOS");
    const restritos = await ctx.db.gedDocumento.count({ where: { AND: [esc.docWhere, { sensibilidade: "RESTRITO" }] } });
    const pastasNaoPublicas = esc.pastas.length ? await ctx.db.gedPasta.count({ where: { id: { in: esc.pastas.map((x) => x.id) }, sensibilidade_padrao: { not: "PUBLICO" } } }) : 0;
    if (e.congelar) {
      if (total > MAX_ITENS_CONGELADOS) throw invalido(`Para congelar a lista, a pasta deve ter no máximo ${MAX_ITENS_CONGELADOS} documentos compartilháveis (tem ${total}). Compartilhe uma subpasta.`);
      congelados = (await ctx.db.gedDocumento.findMany({ where: esc.docWhere, select: { id: true } })).map((x) => x.id);
      avisoRestrito = restritos > 0;
    } else {
      // dinâmico: documentos novos entram no link; como o padrão das pastas é RESTRITO, exige a confirmação sempre que não for tudo PÚBLICO
      avisoRestrito = restritos > 0 || pastasNaoPublicas > 0;
    }
  }
  // (depois do recurso: quem não pode ver o recurso recebe 404/403 antes de saber se há canal configurado)
  const canal = await canalWhatsappDisponivel(ctx.db, ctx.organizacao_id);
  if (!canal.ok) throw new ErroApi(409, "SEM_CANAL_WHATSAPP", `Não é possível criar o link: ${canal.motivo}`);
  if (avisoRestrito && !e.confirmar_restrito) {
    throw new ErroApi(409, "CONFIRMACAO_NECESSARIA", "O conteúdo é RESTRITO (não é público). Confirme que deseja compartilhá-lo externamente.", { campo: "confirmar_restrito" });
  }

  const token = gerarToken();
  const notificar = e.notificar_primeiro_acesso ?? cfg.notificar_acesso;
  const criado = await ctx.db.$transaction(async (tx) => {
    const l = await tx.gedCompartilhamento.create({
      data: {
        criado_por_id: ctx.usuario.id,
        recurso_tipo: e.recurso.tipo === "pasta" ? "PASTA" : "DOCUMENTO",
        documento_id,
        pasta_id,
        recurso_rotulo: rotulo.slice(0, 300),
        token_hash: hashToken(token),
        destinatario_nome: e.destinatario_nome ?? null,
        destinatario_whatsapp_cifrado: cifrar(telefone),
        destinatario_whatsapp_hash: hashBusca(telefone),
        destinatario_mascarado: mascararWhatsapp(telefone),
        mensagem: e.mensagem ?? null,
        pode_visualizar: permissoes.pode_visualizar,
        pode_baixar: permissoes.pode_baixar,
        pode_zip: permissoes.pode_zip,
        expira_em: calcularExpiracao(agora, dias),
        limite_downloads: e.limite_downloads ?? null,
        congelado: e.congelar && e.recurso.tipo === "pasta",
        itens_congelados: congelados,
        confirmou_restrito: e.confirmar_restrito,
        notificar_primeiro_acesso: notificar,
      } as Prisma.GedCompartilhamentoUncheckedCreateInput,
    });
    await tx.gedCompartilhamentoEvento.create({ data: dadosEvento(ctx.organizacao_id, l.id, "LINK_CRIADO", {}, { detalhe: `${l.recurso_tipo === "PASTA" ? "pasta" : "documento"}; validade ${dias} dia(s)` }) });
    await auditarGed(
      ctx,
      {
        acao: "GED_COMPARTILHAMENTO_CRIADO", entidade: "ged_compartilhamento", entidade_id: l.id,
        depois: { recurso_tipo: l.recurso_tipo, documento_id, pasta_id, destinatario: l.destinatario_mascarado, expira_em: l.expira_em.toISOString(), pode_baixar: l.pode_baixar, pode_zip: l.pode_zip, congelado: l.congelado, itens: congelados.length, confirmou_restrito: e.confirmar_restrito },
      },
      tx,
    );
    return l;
  });

  const caminho = `/compartilhado/${token}`;
  const url = `${baseUrlApp()}${caminho}`;
  let link_whatsapp: CompartilhamentoCriado["link_whatsapp"] = "NAO_SOLICITADO";
  if (e.enviar_link_whatsapp) {
    try {
      await enviarWhatsappGed(ctx.db, ctx.organizacao_id, telefone, textoLink(ctx.organizacao.nome, ctx.usuario.nome, rotulo, url));
      link_whatsapp = "ENVIADO";
      await ctx.db.gedCompartilhamento.update({ where: { id: criado.id }, data: { link_enviado_whatsapp_em: new Date() } });
      await registrarEventoCompartilhamento(ctx.db, ctx.organizacao_id, criado.id, "LINK_ENVIADO_WHATSAPP");
    } catch (err) {
      link_whatsapp = "FALHOU";
      console.error("[ged-compartilhamento] envio do link por WhatsApp falhou:", err instanceof Error ? err.message : err);
    }
  }
  const nomes = await nomeUsuario(ctx, [criado.criado_por_id]);
  return { ...paraView({ ...criado, link_enviado_whatsapp_em: link_whatsapp === "ENVIADO" ? new Date() : criado.link_enviado_whatsapp_em }, nomes, agora), token, caminho, url, link_whatsapp, aviso_restrito: avisoRestrito };
}

// ───────────── Listar / detalhar ─────────────

export type FiltroLista = { escopo?: "meus" | "todos"; status?: "ATIVO" | "REVOGADO" | "EXPIRADO" | null; recurso_tipo?: "DOCUMENTO" | "PASTA" | null; recurso_id?: string | null; page?: number; size?: number };

function whereLista(ctx: CtxGed, f: FiltroLista, agora: Date): Prisma.GedCompartilhamentoWhereInput {
  const and: Prisma.GedCompartilhamentoWhereInput[] = [];
  // Admin pode ver todos do cliente; os demais SÓ os próprios (mesmo que peçam "todos").
  if (!(podeAdministrarGed(ctx) && f.escopo === "todos")) and.push({ criado_por_id: ctx.usuario.id });
  if (f.status === "ATIVO") and.push({ status: "ATIVO", expira_em: { gt: agora } });
  else if (f.status === "EXPIRADO") and.push({ OR: [{ status: "EXPIRADO" }, { status: "ATIVO", expira_em: { lte: agora } }] });
  else if (f.status === "REVOGADO") and.push({ status: "REVOGADO" });
  if (f.recurso_tipo) and.push({ recurso_tipo: f.recurso_tipo });
  if (f.recurso_id && /^[0-9a-f-]{36}$/i.test(f.recurso_id)) and.push({ OR: [{ documento_id: f.recurso_id }, { pasta_id: f.recurso_id }] });
  return { AND: and };
}

export async function listarCompartilhamentos(ctx: CtxGed, f: FiltroLista = {}): Promise<{ itens: CompartilhamentoView[]; total: number; page: number; size: number; pode_ver_todos: boolean }> {
  if (!podeCompartilhar(ctx)) throw proibido(SEM_PERMISSAO);
  const page = Math.max(1, f.page ?? 1);
  const size = Math.min(100, Math.max(1, f.size ?? 20));
  const agora = new Date();
  const where = whereLista(ctx, f, agora);
  const [linhas, total] = await Promise.all([
    ctx.db.gedCompartilhamento.findMany({ where, orderBy: [{ created_at: "desc" }], skip: (page - 1) * size, take: size }),
    ctx.db.gedCompartilhamento.count({ where }),
  ]);
  const nomes = await nomeUsuario(ctx, linhas.map((l) => l.criado_por_id));
  return { itens: linhas.map((l) => paraView(l, nomes, agora)), total, page, size, pode_ver_todos: podeAdministrarGed(ctx) };
}

export type EventoView = { id: string; created_at: Date; tipo: string; rotulo: string; documento_id: string | null; documento_titulo: string | null; ip: string | null; user_agent: string | null; detalhe: string | null };

async function carregarDoUsuario(ctx: CtxGed, id: string): Promise<GedCompartilhamento> {
  if (!podeCompartilhar(ctx)) throw proibido(SEM_PERMISSAO);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw naoEncontrado("Compartilhamento não encontrado.");
  const l = await ctx.db.gedCompartilhamento.findUnique({ where: { id } });
  // de outro cliente = null (escopo); de outro usuário do mesmo cliente: só o Admin enxerga (os demais recebem 404)
  if (!l || (l.criado_por_id !== ctx.usuario.id && !podeAdministrarGed(ctx))) throw naoEncontrado("Compartilhamento não encontrado.");
  return l;
}

export async function detalharCompartilhamento(ctx: CtxGed, id: string): Promise<{ compartilhamento: CompartilhamentoView; eventos: EventoView[] }> {
  const l = await carregarDoUsuario(ctx, id);
  const [ev, nomes] = await Promise.all([
    ctx.db.gedCompartilhamentoEvento.findMany({ where: { compartilhamento_id: l.id }, orderBy: [{ created_at: "desc" }], take: 300 }),
    nomeUsuario(ctx, [l.criado_por_id]),
  ]);
  const docIds = [...new Set(ev.flatMap((x) => (x.documento_id ? [x.documento_id] : [])))];
  const docs = docIds.length ? await ctx.db.gedDocumento.findMany({ where: { id: { in: docIds } }, select: { id: true, numero: true, titulo: true } }) : [];
  const dp = new Map(docs.map((d) => [d.id, `${d.numero} – ${d.titulo}`]));
  return {
    compartilhamento: paraView(l, nomes),
    eventos: ev.map((x) => ({ id: x.id, created_at: x.created_at, tipo: x.tipo, rotulo: (ROTULO_EVENTO_COMPARTILHAMENTO as Record<string, string>)[x.tipo] ?? x.tipo, documento_id: x.documento_id, documento_titulo: x.documento_id ? dp.get(x.documento_id) ?? null : null, ip: x.ip, user_agent: x.user_agent, detalhe: x.detalhe })),
  };
}

// ───────────── Revogar ─────────────

/** Efeito imediato: o status vale em TODA requisição pública; as sessões abertas também são encerradas. Idempotente. */
export async function revogarCompartilhamento(ctx: CtxGed, id: string, motivo?: string | null): Promise<CompartilhamentoView> {
  const l = await carregarDoUsuario(ctx, id);
  const agora = new Date();
  await ctx.db.$transaction(async (tx) => {
    const r = await tx.gedCompartilhamento.updateMany({
      where: { id: l.id, status: { not: "REVOGADO" } },
      data: { status: "REVOGADO", revogado_em: agora, revogado_por_id: ctx.usuario.id, revogado_motivo: motivo?.trim().slice(0, 300) || null },
    });
    if (r.count === 1) {
      await tx.gedCompartilhamentoSessao.updateMany({ where: { compartilhamento_id: l.id, encerrada_em: null }, data: { encerrada_em: agora } });
      await tx.gedCompartilhamentoEvento.create({ data: dadosEvento(ctx.organizacao_id, l.id, "REVOGADO", {}, { detalhe: ctx.usuario.id === l.criado_por_id ? "por quem compartilhou" : "pelo administrador" }) });
      await auditarGed(ctx, { acao: "GED_COMPARTILHAMENTO_REVOGADO", entidade: "ged_compartilhamento", entidade_id: l.id, depois: { recurso_tipo: l.recurso_tipo, documento_id: l.documento_id, pasta_id: l.pasta_id, motivo: motivo ?? null } }, tx);
    }
  });
  const atual = exigirEncontrado(await ctx.db.gedCompartilhamento.findUnique({ where: { id: l.id } }));
  return paraView(atual, await nomeUsuario(ctx, [atual.criado_por_id]));
}

// ───────────── Configuração (Administrador) ─────────────

export async function salvarConfigCompartilhamento(ctx: CtxGed, entrada: { ativo: boolean; validade_padrao_dias: number; validade_max_dias: number; notificar_acesso: boolean }): Promise<void> {
  if (!podeAdministrarGed(ctx)) throw proibido("Somente o administrador altera estas configurações.");
  const max = Math.floor(entrada.validade_max_dias);
  const padrao = Math.floor(entrada.validade_padrao_dias);
  if (!(max >= 1 && max <= 30)) throw invalido("A validade máxima deve ficar entre 1 e 30 dias.", { campo: "validade_max_dias" });
  if (!(padrao >= 1 && padrao <= max)) throw invalido("A validade padrão deve ficar entre 1 dia e a validade máxima.", { campo: "validade_padrao_dias" });
  const antes = await lerConfigCompartilhamento(ctx);
  const dados = { compartilhamento_ativo: entrada.ativo, compartilhamento_validade_padrao_dias: padrao, compartilhamento_validade_max_dias: max, compartilhamento_notificar_acesso: entrada.notificar_acesso };
  await ctx.db.$transaction(async (tx) => {
    await tx.gedConfig.upsert({ where: { organizacao_id: ctx.organizacao_id }, create: dados as Prisma.GedConfigUncheckedCreateInput, update: dados });
    await auditarGed(ctx, { acao: "GED_COMPARTILHAMENTO_CONFIG_ALTERADA", entidade: "ged_config", entidade_id: ctx.organizacao_id, antes, depois: { ativo: entrada.ativo, validade_padrao_dias: padrao, validade_max_dias: max, notificar_acesso: entrada.notificar_acesso } }, tx);
  });
}

// ───────────── Aviso ao criador no 1º acesso (e-mail; best-effort) ─────────────

export async function avisarPrimeiroAcesso(ctx: Pick<CtxGed, "db" | "organizacao">, l: Pick<GedCompartilhamento, "id" | "criado_por_id" | "recurso_rotulo" | "destinatario_nome" | "destinatario_mascarado">, quando: Date): Promise<void> {
  try {
    const u = await ctx.db.usuario.findFirst({ where: { id: l.criado_por_id, ativo: true }, select: { email: true, nome: true } });
    if (!u?.email) return;
    const quem = l.destinatario_nome ? `${l.destinatario_nome} (${l.destinatario_mascarado})` : l.destinatario_mascarado;
    const link = `${baseUrlApp()}/ged/compartilhamentos/${l.id}`;
    const html = `<p>Olá, ${escHtml(u.nome.split(" ")[0])}.</p><p><strong>${escHtml(quem)}</strong> acessou pela primeira vez o link que você compartilhou: <strong>${escHtml(l.recurso_rotulo)}</strong> (${escHtml(quando.toISOString().replace("T", " ").slice(0, 16))} UTC).</p><p>Acompanhe os acessos ou revogue o link em <a href="${escHtml(link)}">${escHtml(link)}</a>.</p><p style="color:#64748b;font-size:12px">${escHtml(ctx.organizacao.nome)} – Gestão de Documentos. Mensagem automática.</p>`;
    await enviarEmail(u.email, "Gestão de Documentos: seu link compartilhado foi acessado", html);
  } catch (e) {
    console.error("[ged-compartilhamento] aviso de primeiro acesso falhou:", e instanceof Error ? e.message : e);
  }
}

