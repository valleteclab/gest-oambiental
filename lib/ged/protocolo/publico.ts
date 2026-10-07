// Protocolo PÚBLICO (sem login): portal do cidadão /protocolo/{slug}, consulta por número + código e verificação do comprovante.
//
// ISOLAMENTO: o slug resolve UMA organização (resolverSlugPortal em lib/ged/db.ts, só ids); daí em diante tudo passa por
// gedDb(organizacao_id). Slug inexistente OU portal desligado → null (a página responde 404, indistinguível). Nada de uma organização
// aparece em outra. A consulta pública NUNCA devolve dado pessoal, anexos nem despacho interno: só número, assunto, datas,
// situação e as mensagens marcadas como públicas (resposta/devolução/indeferimento).
import { verificarAssinaturaPdf } from "@/lib/assinatura/assinar";
import { ErroApi, invalido } from "@/lib/http";
import { cache } from "react";
import { createHash } from "node:crypto";
import { gedDb, resolverCodigoVerificacaoProtocolo, resolverSlugPortal } from "../db";
import { ctxGedPorUsuarioId, type CtxGed } from "../escopo";
import { lerArquivoGed, validarUploadGed } from "../storage";
import { normalizarCodigoGed } from "../assinaturas/regras";
import { emitirComprovanteProtocolo, criarProtocoloNaBase, lerComprovante, type AnexoEntrada } from "./servico";
import { limitesAnexos, lerNumeroProtocolo, normalizarCodigoProtocolo, prazoPorDias, ROTULO_LIVRO, rotuloPublicoEvento, rotuloSituacao, zEnvioPortal, situacaoConclui } from "./regras";

export type PortalPublico = {
  slug: string;
  organizacao_id: string;
  organizacao: { nome: string; sigla: string; logo_url: string | null };
  orientacao: string | null;
  assuntos: { id: string; nome: string; descricao: string | null }[];
  limites: { max_anexos: number; max_mb: number; max_bytes: number };
  responsavel_id: string;
};

/** Portal ligado e utilizável (responsável válido e ao menos um assunto ativo)? Senão null → 404. */
export async function carregarPortal(slug: string): Promise<PortalPublico | null> {
  const r = await resolverSlugPortal(slug);
  if (!r) return null;
  const db = gedDb(r.organizacao_id);
  const cfg = await db.gedConfig.findFirst({ select: { protocolo_portal_ativo: true, protocolo_orientacao: true, protocolo_max_anexos: true, protocolo_max_mb: true, protocolo_responsavel_id: true } });
  if (!cfg?.protocolo_portal_ativo || !cfg.protocolo_responsavel_id) return null;
  const [org, assuntos] = await Promise.all([
    db.organizacao.findUnique({ where: { id: r.organizacao_id }, select: { nome: true, sigla: true, logo_url: true } }),
    db.gedProtocoloAssunto.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true, descricao: true } }),
  ]);
  if (!org || assuntos.length === 0) return null;
  const lim = limitesAnexos(cfg);
  return { slug, organizacao_id: r.organizacao_id, organizacao: org, orientacao: cfg.protocolo_orientacao, assuntos, limites: { max_anexos: lim.max_anexos, max_mb: lim.max_mb, max_bytes: lim.max_bytes }, responsavel_id: cfg.protocolo_responsavel_id };
}
/** Memoizado por requisição (layout + página não repetem a consulta). */
export const carregarPortalCache = cache(carregarPortal);

export type ResultadoEnvioPortal =
  | { robo: true }
  | { robo?: false; numero: string; codigo_consulta: string; registrado_em: Date; anexos: number; comprovante_disponivel: boolean };

/** Texto de erro do arquivo sem revelar detalhes internos. */
function validarArquivosPortal(portal: PortalPublico, arquivos: AnexoEntrada[]) {
  if (arquivos.length > portal.limites.max_anexos) throw invalido(portal.limites.max_anexos === 0 ? "Este portal não recebe arquivos." : `Envie no máximo ${portal.limites.max_anexos} arquivo(s).`);
  for (const a of arquivos) {
    if (a.arquivo.length > portal.limites.max_bytes) throw invalido(`Cada arquivo pode ter até ${portal.limites.max_mb} MB.`);
    const v = validarUploadGed(a.arquivo, a.nome_arquivo, a.mime);
    if (!v.ok) throw invalido(`${v.erro} (${a.nome_arquivo.slice(0, 80)})`);
  }
}

/**
 * Cria o protocolo ENTRADA enviado pelo cidadão. Honeypot preenchido → `{ robo: true }` (nada é criado; a rota responde com
 * sucesso genérico). Os documentos nascem do RESPONSÁVEL configurado, restritos e marcados "contém dados pessoais".
 */
export async function protocolarPeloPortal(portal: PortalPublico, entrada: unknown, arquivos: AnexoEntrada[]): Promise<ResultadoEnvioPortal> {
  const e = zEnvioPortal.parse(entrada);
  if (e.website) return { robo: true };
  validarArquivosPortal(portal, arquivos);
  const db = gedDb(portal.organizacao_id);
  const assunto = await db.gedProtocoloAssunto.findFirst({ where: { id: e.assunto_id, ativo: true } });
  if (!assunto) throw invalido("Escolha um assunto da lista.");
  const ctx = await ctxGedPorUsuarioId(portal.responsavel_id);
  if (!ctx || ctx.organizacao_id !== portal.organizacao_id) throw new ErroApi(503, "INDISPONIVEL", "O protocolo online está temporariamente indisponível. Tente novamente mais tarde.");
  const agora = new Date();
  const r = await criarProtocoloNaBase(ctx, {
    livro: "ENTRADA", origem: "PORTAL", assunto: assunto.nome, descricao: e.descricao, tipo_documento_id: assunto.tipo_documento_id, prioridade: assunto.prioridade,
    prazo_resposta_em: prazoPorDias(agora, assunto.prazo_dias), origem_setor_id: null,
    interessado: { nome: e.nome, cpf_cnpj: e.cpf_cnpj, email: e.email, telefone: e.telefone ?? null },
    destino_setor_id: assunto.destino_setor_id, destino_usuario_id: null, criado_por_id: null, consentimento_lgpd_em: agora, anexos_com_dados_pessoais: true,
  }, arquivos);
  return { numero: r.numero, codigo_consulta: r.codigo_consulta, registrado_em: r.registrado_em, anexos: r.anexos, comprovante_disponivel: r.comprovante.emitido };
}

// ───────────── Consulta pública ─────────────

export type ConsultaPublica = {
  numero: string;
  organizacao: string;
  assunto: string;
  registrado_em: Date;
  situacao: string;
  situacao_codigo: string;
  concluido: boolean;
  prazo_resposta_em: Date | null;
  andamento: { quando: Date; rotulo: string; situacao: string; mensagem: string | null }[];
  comprovante_disponivel: boolean;
};

/** null = número/código não conferem (mensagem genérica; nunca diz qual dos dois errou). */
export async function consultarPublico(portal: Pick<PortalPublico, "organizacao_id">, numeroBruto: string, codigoBruto: string): Promise<ConsultaPublica | null> {
  const numero = lerNumeroProtocolo(numeroBruto)?.numero;
  const codigo = normalizarCodigoProtocolo(codigoBruto);
  if (!numero || !codigo) return null;
  const db = gedDb(portal.organizacao_id);
  const p = await db.gedProtocolo.findFirst({ where: { numero, codigo_consulta: codigo, livro: "ENTRADA" } });
  if (!p) return null;
  const [eventos, org] = await Promise.all([
    db.gedProtocoloEvento.findMany({ where: { protocolo_id: p.id }, orderBy: [{ created_at: "asc" }, { id: "asc" }], select: { tipo: true, situacao_para: true, created_at: true, texto_publico: true } }),
    db.organizacao.findUnique({ where: { id: portal.organizacao_id }, select: { nome: true } }),
  ]);
  return {
    numero: p.numero, organizacao: org?.nome ?? "", assunto: p.assunto, registrado_em: p.created_at,
    situacao: rotuloSituacao(p.situacao, p.livro), situacao_codigo: p.situacao, concluido: situacaoConclui(p.situacao), prazo_resposta_em: p.prazo_resposta_em,
    andamento: eventos.map((e) => ({ quando: e.created_at, rotulo: rotuloPublicoEvento(e.tipo, p.livro), situacao: rotuloSituacao(e.situacao_para, p.livro), mensagem: e.texto_publico })),
    comprovante_disponivel: !!p.comprovante_sha256,
  };
}

/** PDF do comprovante para o cidadão (número + código). Se por algum motivo ainda não foi emitido, emite agora. */
export async function comprovantePublico(portal: PortalPublico, numeroBruto: string, codigoBruto: string): Promise<{ buffer: Buffer; nome: string; sha256: string } | null> {
  const numero = lerNumeroProtocolo(numeroBruto)?.numero;
  const codigo = normalizarCodigoProtocolo(codigoBruto);
  if (!numero || !codigo) return null;
  const db = gedDb(portal.organizacao_id);
  const p = await db.gedProtocolo.findFirst({ where: { numero, codigo_consulta: codigo, livro: "ENTRADA" }, select: { id: true, comprovante_sha256: true } });
  if (!p) return null;
  if (!p.comprovante_sha256) {
    const ctx: CtxGed | null = await ctxGedPorUsuarioId(portal.responsavel_id);
    if (!ctx || ctx.organizacao_id !== portal.organizacao_id) return null;
    await emitirComprovanteProtocolo(ctx, p.id);
  }
  return lerComprovante({ db, organizacao_id: portal.organizacao_id }, p.id);
}

// ───────────── Verificação pública do comprovante (QR) ─────────────

export type VerificacaoProtocolo = {
  codigo: string;
  situacao: "VALIDO" | "INCONSISTENTE";
  organizacao: string;
  numero: string;
  livro: string;
  registrado_em: Date;
  situacao_protocolo: string;
  emitido_em: Date | null;
  sha256: string | null;
  assinado_pades: boolean;
  arquivo_integro: boolean | null;
  pades_ok: boolean;
  signatario: string | null;
};

/**
 * `null` = código inexistente/inválido (resposta idêntica; sem pista de enumeração). Só devolve número, data, órgão, livro,
 * situação e o resultado da conferência do hash – sem assunto, sem interessado, sem anexos.
 */
export async function verificarComprovantePublico(codigoBruto: string): Promise<VerificacaoProtocolo | null> {
  const codigo = normalizarCodigoGed(codigoBruto);
  if (!codigo) return null;
  const alvo = await resolverCodigoVerificacaoProtocolo(codigo);
  if (!alvo) return null;
  const db = gedDb(alvo.organizacao_id);
  const p = await db.gedProtocolo.findUnique({ where: { id: alvo.protocolo_id } });
  if (!p) return null;
  const org = await db.organizacao.findUnique({ where: { id: alvo.organizacao_id }, select: { nome: true } });
  let integro: boolean | null = null;
  let pades: { ok: boolean; signatario: string | null } | null = null;
  if (p.comprovante_versao_id && p.comprovante_sha256) {
    try {
      const v = await db.gedVersaoDocumento.findUnique({ where: { id: p.comprovante_versao_id }, select: { storage_key: true, sha256: true } });
      const buf = v ? await lerArquivoGed(alvo.organizacao_id, v.storage_key) : null;
      integro = buf ? createHash("sha256").update(buf).digest("hex") === p.comprovante_sha256 && v?.sha256 === p.comprovante_sha256 : null;
      if (buf && p.comprovante_assinado) {
        const r = verificarAssinaturaPdf(buf);
        pades = { ok: r.assinado && r.integro && r.assinaturaValida && r.cobreArquivo, signatario: r.signatario ?? null };
      }
    } catch {
      integro = null;
    }
  }
  const padesOk = p.comprovante_assinado ? pades?.ok === true : true;
  return {
    codigo, organizacao: org?.nome ?? "", numero: p.numero, livro: ROTULO_LIVRO[p.livro], registrado_em: p.created_at,
    situacao_protocolo: rotuloSituacao(p.situacao, p.livro), emitido_em: p.comprovante_emitido_em, sha256: p.comprovante_sha256,
    assinado_pades: !!p.comprovante_assinado, arquivo_integro: integro, pades_ok: padesOk, signatario: pades?.signatario ?? null,
    situacao: p.comprovante_sha256 && integro === true && padesOk ? "VALIDO" : "INCONSISTENTE",
  };
}
