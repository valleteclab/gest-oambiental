// Compartilhamento externo – lado do DESTINATÁRIO (público, sem login): resolver o link, enviar/validar o OTP, sessão curta, listar,
// ler arquivo e ZIP. ISOLAMENTO: o token (hash) resolve só ids (resolverTokenCompartilhamento, lib/ged/db.ts); o resto passa por
// gedDb(organizacao_id). Link inexistente, vencido, revogado, recurso excluído ou criador sem acesso → TODOS viram o mesmo 404
// (MENSAGEM_LINK_INVALIDO), sem pista de qual caso. Status e validade são conferidos a CADA requisição (revogar derruba na hora).
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import type { GedCompartilhamento } from "@prisma/client";
import { cifrar, decifrar } from "@/lib/crypto";
import { ErroApi } from "@/lib/http";
import { gedDb, resolverTokenCompartilhamento, type GedDb } from "../db";
import { criarStreamZip, planejarExportacaoPasta } from "../exportacao-pasta/servico";
import { dataHoraBrasilia } from "../templates";
import {
  carregarEscopoLink, lerArquivoPermitido, listarItensPermitidos, pastaDoZip, type ArquivoPermitido, type EscopoLink, type ListaItens,
} from "./conteudo";
import { registrarEventoCompartilhamento, type MetaEvento } from "./eventos";
import { exigirEnvioOtpPermitido, exigirIpSemBloqueioOtp, registrarCodigoErradoIp } from "./limites";
import { avisarPrimeiroAcesso } from "./servico";
import {
  bloqueioProgressivoMs, conferirOtp, decidirEnvioOtp, downloadsEsgotados, gerarOtp, gerarSal, hashIp, hashOtp, hashToken, hashUserAgent, linkVigente, MENSAGEM_LINK_INVALIDO,
  normalizarCodigoOtp, OTP_MAX_ENVIOS_HORA, OTP_MAX_TENTATIVAS, OTP_VALIDADE_MS, renovarSessao, situacaoOtp, situacaoSessao, terminacaoWhatsapp, tetoDaSessao, tokenValido, whereCompartilhavel,
} from "./regras";
import { enviarWhatsappGed, textoOtp } from "./whatsapp";

export const linkInvalido = () => new ErroApi(404, "NAO_ENCONTRADO", MENSAGEM_LINK_INVALIDO);

export type MetaAcesso = MetaEvento & { ip: string; user_agent: string | null };

export type LinkPublico = {
  db: GedDb;
  organizacao_id: string;
  link: GedCompartilhamento;
  organizacao: { nome: string; logo_url: string | null };
  criador_nome: string;
};

/**
 * Resolve o token. null = qualquer motivo de indisponibilidade (formato, inexistente, revogado, vencido, desativado pelo cliente).
 * Um ATIVO vencido é marcado EXPIRADO aqui mesmo (idempotente), com o evento correspondente.
 */
export async function carregarLinkPublico(token: string): Promise<LinkPublico | null> {
  if (!tokenValido(token)) return null;
  const r = await resolverTokenCompartilhamento(hashToken(token));
  if (!r) return null;
  const db = gedDb(r.organizacao_id);
  const link = await db.gedCompartilhamento.findUnique({ where: { id: r.compartilhamento_id } });
  if (!link) return null;
  const agora = new Date();
  if (!linkVigente(link, agora)) {
    if (link.status === "ATIVO") {
      const x = await db.gedCompartilhamento.updateMany({ where: { id: link.id, status: "ATIVO", expira_em: { lte: agora } }, data: { status: "EXPIRADO" } });
      if (x.count === 1) {
        await db.gedCompartilhamentoSessao.updateMany({ where: { compartilhamento_id: link.id, encerrada_em: null }, data: { encerrada_em: agora } });
        await registrarEventoCompartilhamento(db, r.organizacao_id, link.id, "EXPIRADO");
      }
    }
    return null;
  }
  const [cfg, org, criador] = await Promise.all([
    db.gedConfig.findFirst({ select: { compartilhamento_ativo: true } }),
    db.organizacao.findUnique({ where: { id: r.organizacao_id }, select: { nome: true, logo_url: true, modulos: true } }),
    db.usuario.findFirst({ where: { id: link.criado_por_id, organizacao_id: r.organizacao_id, ativo: true }, select: { nome: true } }),
  ]);
  if (cfg && !cfg.compartilhamento_ativo) return null;
  if (!org || !org.modulos.includes("GED") || !criador) return null;
  return { db, organizacao_id: r.organizacao_id, link, organizacao: { nome: org.nome, logo_url: org.logo_url }, criador_nome: criador.nome };
}

// ───────────── OTP: envio ─────────────

export type ResultadoEnvioOtp = { terminacao: string; reenvio_em_s: number; validade_min: number };

/**
 * Gera e envia o código ao WhatsApp cadastrado por quem compartilhou. Limites: 60 s entre envios e 5 por hora POR LINK (banco),
 * por IP (memória) e bloqueio progressivo do link por falhas. Lança ErroApi 429 (com retry_after) ou 502 se o canal falhar.
 */
export async function solicitarOtp(l: LinkPublico, meta: MetaAcesso, agora = new Date()): Promise<ResultadoEnvioOtp> {
  const { db, organizacao_id, link } = l;
  exigirIpSemBloqueioOtp(meta.ip);
  if (link.bloqueado_ate && link.bloqueado_ate.getTime() > agora.getTime()) {
    throw new ErroApi(429, "MUITAS_TENTATIVAS", "Muitas tentativas incorretas. Aguarde alguns minutos para pedir um novo código.", { retry_after: Math.ceil((link.bloqueado_ate.getTime() - agora.getTime()) / 1000) });
  }
  exigirEnvioOtpPermitido(meta.ip);
  const recentes = await db.gedCompartilhamentoOtp.findMany({ where: { compartilhamento_id: link.id, created_at: { gt: new Date(agora.getTime() - 3_600_000) } }, select: { created_at: true }, orderBy: { created_at: "asc" } });
  const dec = decidirEnvioOtp(recentes.map((x) => x.created_at), agora);
  if (!dec.ok) {
    const msg = dec.motivo === "INTERVALO" ? `Aguarde ${dec.retry_after_s} segundo(s) para pedir um novo código.` : `Limite de ${OTP_MAX_ENVIOS_HORA} códigos por hora atingido. Tente novamente mais tarde.`;
    throw new ErroApi(429, "MUITAS_TENTATIVAS", msg, { retry_after: dec.retry_after_s, motivo: dec.motivo });
  }
  const telefone = decifrar(link.destinatario_whatsapp_cifrado);
  if (!telefone) throw new ErroApi(502, "ENVIO_FALHOU", "Não foi possível enviar o código agora. Tente novamente em instantes.");

  const codigo = gerarOtp();
  const sal = gerarSal();
  const simulado = process.env.CANAIS_ENVIO_SIMULADO === "true";
  // invalida os códigos anteriores ainda não usados (só o último vale) e cria o novo ANTES de enviar (conta no limite mesmo se falhar)
  const otp = await db.$transaction(async (tx) => {
    await tx.gedCompartilhamentoOtp.updateMany({ where: { compartilhamento_id: link.id, usado_em: null, invalidado_em: null }, data: { invalidado_em: agora } });
    return tx.gedCompartilhamentoOtp.create({
      data: {
        compartilhamento_id: link.id,
        codigo_hash: hashOtp(codigo, sal, link.id),
        sal,
        expira_em: new Date(agora.getTime() + OTP_VALIDADE_MS),
        ip_hash: hashIp(meta.ip),
        codigo_teste_cifrado: simulado ? cifrar(codigo) : null, // SÓ em ensaio (CANAIS_ENVIO_SIMULADO): permite ao E2E ler o código
      } as never,
    });
  });
  try {
    await enviarWhatsappGed(db, organizacao_id, telefone, textoOtp(l.organizacao.nome, codigo));
    await db.gedCompartilhamentoOtp.update({ where: { id: otp.id }, data: { enviado_em: new Date() } });
    await registrarEventoCompartilhamento(db, organizacao_id, link.id, "OTP_ENVIADO", meta, { detalhe: simulado ? "simulado" : null });
  } catch (e) {
    await db.gedCompartilhamentoOtp.update({ where: { id: otp.id }, data: { invalidado_em: new Date(), erro_envio: (e instanceof Error ? e.message : "falha").slice(0, 200) } });
    await registrarEventoCompartilhamento(db, organizacao_id, link.id, "OTP_ENVIO_FALHOU", meta, { detalhe: (e instanceof Error ? e.message : "falha").slice(0, 120) });
    throw new ErroApi(502, "ENVIO_FALHOU", "Não foi possível enviar o código agora. Tente novamente em instantes.");
  }
  return { terminacao: terminacaoWhatsapp(telefone), reenvio_em_s: 60, validade_min: OTP_VALIDADE_MS / 60_000 };
}

// ───────────── OTP: validação e sessão ─────────────

export class CodigoIncorreto extends ErroApi {
  constructor(public restantes: number, msg = "Código incorreto ou expirado.") {
    super(422, "CODIGO_INVALIDO", msg, { tentativas_restantes: restantes });
  }
}

/** Confere o código. Acerto: consome o OTP (uso único), cria a sessão e devolve o valor do cookie (o hash é que fica no banco). */
export async function validarOtp(l: LinkPublico, codigoBruto: unknown, meta: MetaAcesso, agora = new Date()): Promise<{ sessao_token: string; primeiro_acesso: boolean }> {
  const { db, organizacao_id, link } = l;
  exigirIpSemBloqueioOtp(meta.ip);
  if (link.bloqueado_ate && link.bloqueado_ate.getTime() > agora.getTime()) {
    await registrarEventoCompartilhamento(db, organizacao_id, link.id, "OTP_BLOQUEADO", meta);
    throw new ErroApi(429, "MUITAS_TENTATIVAS", "Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.", { retry_after: Math.ceil((link.bloqueado_ate.getTime() - agora.getTime()) / 1000) });
  }
  const codigo = normalizarCodigoOtp(codigoBruto);
  const otp = await db.gedCompartilhamentoOtp.findFirst({ where: { compartilhamento_id: link.id, usado_em: null, invalidado_em: null }, orderBy: { created_at: "desc" } });
  const vigente = otp && situacaoOtp(otp, agora) === "VIGENTE" ? otp : null;

  const falhar = async (): Promise<never> => {
    registrarCodigoErradoIp(meta.ip);
    let restantes = 0;
    if (vigente) {
      const t = await db.gedCompartilhamentoOtp.update({ where: { id: vigente.id }, data: { tentativas: { increment: 1 } } });
      restantes = Math.max(0, OTP_MAX_TENTATIVAS - t.tentativas);
      if (restantes === 0) await db.gedCompartilhamentoOtp.update({ where: { id: vigente.id }, data: { invalidado_em: agora } });
    }
    const atualizado = await db.gedCompartilhamento.update({ where: { id: link.id }, data: { otp_falhas: { increment: 1 } } });
    const espera = bloqueioProgressivoMs(atualizado.otp_falhas);
    if (espera > 0) await db.gedCompartilhamento.update({ where: { id: link.id }, data: { bloqueado_ate: new Date(agora.getTime() + espera) } });
    await registrarEventoCompartilhamento(db, organizacao_id, link.id, "OTP_FALHOU", meta, { detalhe: vigente ? `restam ${restantes}` : "sem código vigente" });
    throw new CodigoIncorreto(restantes, vigente ? undefined : "Código incorreto ou expirado. Peça um novo código.");
  };

  if (!vigente || !codigo) return falhar();
  if (!conferirOtp(codigo, vigente.codigo_hash, vigente.sal, link.id)) return falhar();

  // uso único: só um pedido consegue marcar `usado_em`
  const usou = await db.gedCompartilhamentoOtp.updateMany({ where: { id: vigente.id, usado_em: null, invalidado_em: null, tentativas: { lt: OTP_MAX_TENTATIVAS } }, data: { usado_em: agora } });
  if (usou.count !== 1) return falhar();
  const sessaoToken = randomBytes(32).toString("base64url");
  await db.gedCompartilhamentoSessao.create({
    data: { compartilhamento_id: link.id, token_hash: hashToken(sessaoToken), ua_hash: hashUserAgent(meta.user_agent), expira_em: renovarSessao(agora, tetoDaSessao(agora)), teto_em: tetoDaSessao(agora), ultimo_uso_em: agora } as never,
  });
  const primeiro = await db.gedCompartilhamento.updateMany({ where: { id: link.id, primeiro_acesso_em: null }, data: { primeiro_acesso_em: agora } });
  await db.gedCompartilhamento.update({ where: { id: link.id }, data: { otp_falhas: 0, bloqueado_ate: null, ultimo_acesso_em: agora } });
  await registrarEventoCompartilhamento(db, organizacao_id, link.id, "OTP_VALIDADO", meta);
  if (primeiro.count === 1 && link.notificar_primeiro_acesso) {
    const cfg = await db.gedConfig.findFirst({ select: { compartilhamento_notificar_acesso: true } });
    if (cfg?.compartilhamento_notificar_acesso !== false) void avisarPrimeiroAcesso({ db, organizacao: { id: organizacao_id, nome: l.organizacao.nome, sigla: "", logo_url: l.organizacao.logo_url } }, link, agora);
  }
  return { sessao_token: sessaoToken, primeiro_acesso: primeiro.count === 1 };
}

/** Sessão válida para este link e este navegador? Renova a janela deslizante (no máximo 1×/min) respeitando o teto de 2 h. */
export async function sessaoValida(l: LinkPublico, cookie: string | null | undefined, userAgent: string | null, agora = new Date()): Promise<boolean> {
  if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return false;
  const s = await l.db.gedCompartilhamentoSessao.findUnique({ where: { token_hash: hashToken(cookie) } });
  if (!s || s.compartilhamento_id !== l.link.id) return false; // sessão de outro link/outro cliente não vale aqui
  if (situacaoSessao(s, hashUserAgent(userAgent), agora) !== "OK") return false;
  if (agora.getTime() - s.ultimo_uso_em.getTime() > 60_000) {
    await l.db.gedCompartilhamentoSessao.update({ where: { id: s.id }, data: { ultimo_uso_em: agora, expira_em: renovarSessao(agora, s.teto_em) } });
  }
  return true;
}

export async function exigirSessao(l: LinkPublico, cookie: string | null | undefined, meta: MetaAcesso): Promise<EscopoLink> {
  if (!(await sessaoValida(l, cookie, meta.user_agent))) throw new ErroApi(401, "NAO_AUTENTICADO", "Confirme o código recebido no WhatsApp para continuar.");
  const escopo = await carregarEscopoLink(l.link);
  if (!escopo) throw linkInvalido();
  return escopo;
}

export async function encerrarSessao(l: LinkPublico, cookie: string | null | undefined, meta: MetaAcesso): Promise<void> {
  if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return;
  const r = await l.db.gedCompartilhamentoSessao.updateMany({ where: { token_hash: hashToken(cookie), compartilhamento_id: l.link.id, encerrada_em: null }, data: { encerrada_em: new Date() } });
  if (r.count === 1) await registrarEventoCompartilhamento(l.db, l.organizacao_id, l.link.id, "SESSAO_ENCERRADA", meta);
}

// ───────────── Conteúdo ─────────────

export type VisaoPublica = ListaItens & {
  organizacao: string;
  compartilhado_por: string;
  rotulo: string;
  mensagem: string | null;
  expira_em: Date;
  permissoes: { pode_visualizar: boolean; pode_baixar: boolean; pode_zip: boolean };
  downloads_restantes: number | null;
};

export async function visaoPublica(l: LinkPublico, escopo: EscopoLink, pastaId: string | null): Promise<VisaoPublica> {
  const itens = await listarItensPermitidos(escopo, pastaId);
  const { link } = l;
  return {
    ...itens,
    organizacao: l.organizacao.nome,
    compartilhado_por: l.criador_nome,
    rotulo: link.recurso_rotulo,
    mensagem: link.mensagem,
    expira_em: link.expira_em,
    permissoes: { pode_visualizar: link.pode_visualizar, pode_baixar: link.pode_baixar, pode_zip: link.pode_zip && link.recurso_tipo === "PASTA" },
    downloads_restantes: link.limite_downloads === null ? null : Math.max(0, link.limite_downloads - link.downloads),
  };
}

/** Reserva UM download (atômico: duas requisições simultâneas não passam do limite). */
async function reservarDownload(l: LinkPublico): Promise<void> {
  const { link, db } = l;
  if (link.limite_downloads === null) {
    await db.gedCompartilhamento.update({ where: { id: link.id }, data: { downloads: { increment: 1 }, ultimo_acesso_em: new Date() } });
    return;
  }
  const r = await db.gedCompartilhamento.updateMany({ where: { id: link.id, downloads: { lt: link.limite_downloads } }, data: { downloads: { increment: 1 }, ultimo_acesso_em: new Date() } });
  if (r.count !== 1) throw new ErroApi(403, "LIMITE_DOWNLOADS", "O limite de downloads deste link foi atingido.");
}

/** Arquivo para ver (inline) ou baixar. Inline exige `pode_visualizar`; baixar exige `pode_baixar` e conta no limite. */
export async function entregarArquivo(l: LinkPublico, escopo: EscopoLink, documentoId: string, inline: boolean, meta: MetaAcesso): Promise<ArquivoPermitido> {
  const { link } = l;
  if (inline && !link.pode_visualizar) throw new ErroApi(403, "PROIBIDO", "Este link não permite visualizar online; use o download.");
  if (!inline) {
    if (!link.pode_baixar) throw new ErroApi(403, "PROIBIDO", "Este link não permite baixar arquivos.");
    if (downloadsEsgotados(link)) throw new ErroApi(403, "LIMITE_DOWNLOADS", "O limite de downloads deste link foi atingido.");
  }
  const arq = await lerArquivoPermitido(escopo, documentoId); // 404 se fora do conjunto permitido
  if (!inline) await reservarDownload(l);
  else await l.db.gedCompartilhamento.update({ where: { id: link.id }, data: { ultimo_acesso_em: new Date() } });
  await registrarEventoCompartilhamento(l.db, l.organizacao_id, link.id, inline ? "VISUALIZOU" : "BAIXOU", meta, { documento_id: arq.documento_id });
  return arq;
}

const leiamePublico = (org: string, quem: string) => (d: { pasta: string; geradoEm: Date; incluidos: number; bytes: number }) =>
  [
    "DOCUMENTOS COMPARTILHADOS",
    "",
    `Órgão: ${org}`,
    `Compartilhado por: ${quem}`,
    `Pasta: ${d.pasta}`,
    `Gerado em (horário de Brasília): ${dataHoraBrasilia(d.geradoEm)}`,
    `Documentos incluídos: ${d.incluidos}`,
    `Tamanho total: ${(d.bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`,
    "",
    "O MANIFESTO.csv lista cada documento (número, título, data, sha256). Esta entrega foi registrada.",
    "",
  ].join("\r\n");

/** ZIP em streaming da pasta (ou subpasta) do link: só o conjunto permitido; sem manifesto de omitidos. Conta 1 download. */
export async function entregarZip(l: LinkPublico, escopo: EscopoLink, pastaId: string | null, meta: MetaAcesso): Promise<{ stream: Readable; nome: string; documentos: number }> {
  const { link, db } = l;
  if (link.recurso_tipo !== "PASTA" || !link.pode_zip || !link.pode_baixar) throw new ErroApi(403, "PROIBIDO", "Este link não permite baixar a pasta em ZIP.");
  if (downloadsEsgotados(link)) throw new ErroApi(403, "LIMITE_DOWNLOADS", "O limite de downloads deste link foi atingido.");
  const alvo = pastaDoZip(escopo, pastaId);
  const plano = await planejarExportacaoPasta(escopo.ctx, alvo, {
    modo: "atual",
    ocultarOmitidos: true,
    extraWhere: { AND: [whereCompartilhavel(), ...(link.congelado ? [{ id: { in: link.itens_congelados } }] : [])] },
  });
  if (plano.entradas.length === 0) throw new ErroApi(404, "NAO_ENCONTRADO", MENSAGEM_LINK_INVALIDO);
  await reservarDownload(l);
  const stream = await criarStreamZip(escopo.ctx, plano, {
    auditoria: false,
    exportadoPor: l.criador_nome,
    leiame: leiamePublico(l.organizacao.nome, l.criador_nome),
    continuar: async () => {
      const atual = await db.gedCompartilhamento.findUnique({ where: { id: link.id }, select: { status: true, expira_em: true } });
      return !!atual && linkVigente(atual, new Date());
    },
    aoFinalizar: async ({ incluidos, bytes, interrompida }) => {
      await registrarEventoCompartilhamento(db, l.organizacao_id, link.id, "BAIXOU_ZIP", meta, { detalhe: `${incluidos.length} documento(s); ${bytes} bytes${interrompida ? "; interrompido" : ""}` });
    },
  });
  return { stream, nome: plano.nomeZip, documentos: plano.entradas.length };
}

