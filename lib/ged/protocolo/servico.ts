// Serviço do PROTOCOLO do GED (livro de entrada, saída e interno). Docs: docs/ged.md §14 e docs/ged-design.md §12.
//
//   registrarProtocolo ........ servidor (balcão/saída/interno): protocolo + anexos (viram GedDocumento) + encaminhamento (trâmite)
//   criarProtocoloNaBase ...... núcleo compartilhado com o portal público (lib/ged/protocolo/publico.ts)
//   executarAcaoProtocolo ..... analisar, encaminhar, responder, arquivar, devolver, indeferir (máquina de situações em regras.ts)
//   emitirComprovanteProtocolo  PDF (+ PAdES do órgão se houver certificado) guardado como documento COMPROVANTE do protocolo
//   listarProtocolos / obterProtocolo ........ consultas (visibilidade por papel/setor; anexos pela permissão do documento)
//
// O registro é IMUTÁVEL (trigger ged_protocolo_imutavel): número, data, interessado, assunto e códigos não mudam; andamento e
// anexos só recebem INSERT. Tudo via ctx.db/gedDb; escrita sempre com auditoria na mesma transação.
import { createHash } from "node:crypto";
import type { GedLivroProtocolo, GedSituacaoProtocolo, Prisma } from "@prisma/client";
import { ErroApi, invalido, proibido } from "@/lib/http";
import { auditar } from "@/lib/audit";
import { htmlParaPdf } from "@/lib/pdf";
import { imagemDataUri, logoProprio } from "@/lib/imagem";
import { assinarComCertificado } from "@/lib/assinatura/servico";
import { semaforo, type Semaforo } from "@/lib/dias";
import { baseUrlApp } from "../assinaturas/regras";
import { qrPng } from "../assinaturas/selo-pdf";
import { certificadoDoCliente } from "../assinaturas/selo";
import { auditarGed } from "../auditoria";
import type { CtxGed, GedTx } from "../contratos";
import { exigirEncontrado, naoEncontrado, resolverCodigoVerificacaoProtocolo } from "../db";
import { criarDocumentoNaTransacao } from "../documentos/servico";
import { iniciarExtracaoAposUpload } from "../documentos/extracao";
import { exigirUploadGedValido, lerArquivoGed } from "../storage";
import { acoesDosDocumentos, whereGedVisivel, carregarDocumentoMin } from "../permissoes";
import { registrarTramite, resolverDestinatario, usuariosAptosAReceber } from "../tramite/servico";
import { enfileirarAvisoInteressado, linkConsulta } from "./aviso";
import { htmlComprovante } from "./comprovante-html";
import { proximoNumeroProtocolo } from "./numeracao";
import { cifrarInteressado, docMascarado, lerInteressado, hashDocumento, type DadosInteressado } from "./pessoal";
import {
  ACOES_COM_TEXTO_PUBLICO, anoBrasilia, gerarCodigosProtocolo, LIMITE_MAX_ANEXOS, notificaInteressado, podeAgirNoProtocolo, podeRegistrarProtocolo, podeVerProtocolo,
  proximaSituacao, ROTULO_ACAO_PROTOCOLO, rotuloSituacao, rotuloPublicoEvento, situacaoConclui, TIPO_EVENTO_DA_ACAO, whereProtocoloEnvolvido,
  whereProtocoloVisivel, zAcaoProtocolo, zRegistroServidor, type AcaoProtocolo, type AtorProtocolo, type EntradaAcaoProtocolo, type RegistroServidor,
} from "./regras";

export type AnexoEntrada = { arquivo: Buffer; nome_arquivo: string; mime: string };

export const ator = (ctx: CtxGed): AtorProtocolo => ({ papel: ctx.membro.papel, usuario_id: ctx.usuario.id, setor_ids: ctx.setor_ids });
const TX_OPC = { maxWait: 15_000, timeout: 60_000 } as const;
const semExt = (n: string) => n.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();

// ───────────────────────── Criação ─────────────────────────

export type DadosCriacao = {
  livro: GedLivroProtocolo;
  origem: "BALCAO" | "PORTAL";
  assunto: string;
  descricao: string | null;
  tipo_documento_id: string | null;
  prioridade: "BAIXA" | "NORMAL" | "ALTA" | "URGENTE";
  prazo_resposta_em: Date | null;
  origem_setor_id: string | null;
  interessado: DadosInteressado | null;
  destino_setor_id: string | null;
  destino_usuario_id: string | null;
  criado_por_id: string | null;
  consentimento_lgpd_em: Date | null;
  /** Anexos recebidos do público: documentos nascem marcados "contém dados pessoais" (anonimização pendente). */
  anexos_com_dados_pessoais: boolean;
};

export type ResultadoCriacao = {
  id: string;
  numero: string;
  livro: GedLivroProtocolo;
  registrado_em: Date;
  codigo_consulta: string;
  codigo_verificacao: string;
  anexos: number;
  encaminhados: number;
  falhas_encaminhamento: number;
  comprovante: { emitido: boolean; assinado: boolean; erro?: string };
};

async function exigirReferencias(ctx: CtxGed, d: DadosCriacao) {
  if (d.tipo_documento_id && !(await ctx.db.gedTipoDocumento.findUnique({ where: { id: d.tipo_documento_id }, select: { id: true } }))) throw invalido("Tipo de documento não encontrado.");
  for (const [id, rotulo] of [[d.origem_setor_id, "origem"], [d.destino_setor_id, "destino"]] as const) {
    if (id && !(await ctx.db.gedSetor.findFirst({ where: { id, ativo: true }, select: { id: true } }))) throw invalido(`Setor de ${rotulo} não encontrado.`);
  }
  if (d.destino_usuario_id) {
    const ok = await usuariosAptosAReceber(ctx.db, ctx, [d.destino_usuario_id]);
    if (ok.length === 0) throw invalido("O destinatário não tem acesso ativo ao módulo ou seu papel não permite receber documentos.");
  }
}

async function codigosUnicos() {
  for (let i = 0; i < 8; i++) {
    const c = gerarCodigosProtocolo();
    if (!(await resolverCodigoVerificacaoProtocolo(c.codigo_verificacao))) return c;
  }
  throw new Error("Protocolo: não foi possível gerar um código único.");
}

/**
 * Núcleo da criação: protocolo + evento REGISTRO + anexos (GedDocumento) + encaminhamento + aviso ao interessado, numa transação.
 * `ctx` é quem detém os documentos criados (o servidor, ou o responsável configurado para o portal). NÃO checa o papel de
 * quem pediu (o chamador já fez); valida só as referências (setor/usuário/tipo) e os arquivos.
 */
export async function criarProtocoloNaBase(ctx: CtxGed, d: DadosCriacao, anexos: AnexoEntrada[]): Promise<ResultadoCriacao> {
  if (anexos.length > LIMITE_MAX_ANEXOS) throw invalido(`Envie no máximo ${LIMITE_MAX_ANEXOS} arquivos por protocolo.`);
  const validos = anexos.map((a) => ({ ...a, v: exigirUploadGedValido(a.arquivo, a.nome_arquivo, a.mime) }));
  await exigirReferencias(ctx, d);
  const codigos = await codigosUnicos();
  const colunas = cifrarInteressado(d.livro === "INTERNO" ? null : d.interessado);
  const temDestino = d.livro !== "SAIDA" && !!(d.destino_setor_id || d.destino_usuario_id);

  const r = await ctx.db.$transaction(async (tx) => {
    const n = await proximoNumeroProtocolo(tx, ctx.organizacao_id, d.livro, anoBrasilia());
    const p = await tx.gedProtocolo.create({
      data: {
        livro: d.livro, ano: n.ano, sequencia: n.sequencia, numero: n.numero, origem: d.origem,
        assunto: d.assunto, descricao: d.descricao, tipo_documento_id: d.tipo_documento_id, prioridade: d.prioridade, prazo_resposta_em: d.prazo_resposta_em,
        origem_setor_id: d.origem_setor_id, ...colunas,
        destino_setor_id: d.livro === "SAIDA" ? null : d.destino_setor_id, destino_usuario_id: d.livro === "SAIDA" ? null : d.destino_usuario_id,
        criado_por_id: d.criado_por_id, consentimento_lgpd_em: d.consentimento_lgpd_em,
        codigo_consulta: codigos.codigo_consulta, codigo_verificacao: codigos.codigo_verificacao,
        situacao: "RECEBIDO",
        setor_atual_id: d.livro === "SAIDA" ? null : d.destino_setor_id, responsavel_id: d.livro === "SAIDA" ? null : d.destino_usuario_id,
      } as Prisma.GedProtocoloUncheckedCreateInput,
      select: { id: true, numero: true, created_at: true, livro: true, situacao: true, interessado_email_cifrado: true },
    });
    await tx.gedProtocoloEvento.create({
      data: {
        protocolo_id: p.id, tipo: "REGISTRO", situacao_de: null, situacao_para: "RECEBIDO", usuario_id: d.criado_por_id,
        para_setor_id: d.livro === "SAIDA" ? null : d.destino_setor_id, para_usuario_id: d.livro === "SAIDA" ? null : d.destino_usuario_id,
        texto_publico: null,
      } as Prisma.GedProtocoloEventoUncheckedCreateInput,
    });

    const docs: { documento_id: string; nome: string }[] = [];
    let ordem = 0;
    for (const a of validos) {
      const doc = await criarDocumentoNaTransacao(tx, ctx, {
        titulo: `${p.numero} – ${semExt(a.v.nome)}`,
        tipo_id: d.tipo_documento_id,
        remetente: d.origem === "PORTAL" ? "Protocolo online" : null,
        sensibilidade: "RESTRITO",
        arquivo: a.arquivo, nome_arquivo: a.nome_arquivo, mime: a.mime,
        dados_pessoais: d.anexos_com_dados_pessoais,
        auditoria: { protocolo: p.numero, origem_protocolo: d.origem },
      });
      await tx.gedProtocoloDocumento.create({
        data: { protocolo_id: p.id, documento_id: doc.id, versao_id: doc.versao_id, finalidade: "ANEXO", nome_arquivo: doc.nome_arquivo, tamanho: doc.tamanho, sha256: doc.sha256, ordem: ++ordem } as Prisma.GedProtocoloDocumentoUncheckedCreateInput,
      });
      docs.push({ documento_id: doc.id, nome: doc.nome_arquivo });
    }
    let encaminhados = 0;
    let falhas = 0;
    if (temDestino) {
      for (const dc of docs) {
        try {
          await registrarTramite(tx, ctx, {
            documento_id: dc.documento_id, tipo: "ENVIO",
            para_setor_id: d.destino_setor_id ?? undefined, para_usuario_id: d.destino_usuario_id ?? undefined,
            despacho: `Protocolo ${p.numero}: ${d.assunto}`.slice(0, 500),
            prazo_em: d.prazo_resposta_em ?? undefined,
          });
          encaminhados++;
        } catch (e) {
          if (!(e instanceof ErroApi)) throw e;
          falhas++; // ex.: destinatário é o próprio autor ou setor sem participante apto: o protocolo fica com o destino, o documento não é movido
        }
      }
    }
    await auditar(
      {
        usuario_id: d.criado_por_id, organizacao_id: ctx.organizacao_id, acao: "GED_PROTOCOLO_REGISTRADO", entidade: "ged_protocolo", entidade_id: p.id,
        depois: { numero: p.numero, livro: d.livro, origem: d.origem, assunto: d.assunto, prioridade: d.prioridade, anexos: docs.length, encaminhados, falhas_encaminhamento: falhas, destino_setor_id: d.destino_setor_id, destino_usuario_id: d.destino_usuario_id, origem_setor_id: d.origem_setor_id },
      },
      tx as never,
    );
    await enfileirarAvisoInteressado(tx, p, "PROTOCOLO_RECEBIDO");
    return { p, docs: docs.length, encaminhados, falhas };
  }, TX_OPC);

  // Texto indexável dos anexos (fora da transação, como no upload comum) e comprovante.
  const versoes = await ctx.db.gedProtocoloDocumento.findMany({ where: { protocolo_id: r.p.id }, select: { versao_id: true } });
  for (const v of versoes) void iniciarExtracaoAposUpload(ctx.organizacao_id, v.versao_id).catch(() => {});
  const comprovante: ResultadoCriacao["comprovante"] = { emitido: false, assinado: false };
  try {
    const c = await emitirComprovanteProtocolo(ctx, r.p.id);
    comprovante.emitido = true;
    comprovante.assinado = c.assinado;
  } catch (e) {
    comprovante.erro = e instanceof Error ? e.message : "erro";
    console.error("[ged-protocolo] comprovante não emitido:", comprovante.erro);
  }
  return {
    id: r.p.id, numero: r.p.numero, livro: d.livro, registrado_em: r.p.created_at, codigo_consulta: codigos.codigo_consulta, codigo_verificacao: codigos.codigo_verificacao,
    anexos: r.docs, encaminhados: r.encaminhados, falhas_encaminhamento: r.falhas, comprovante,
  };
}

/** Registro por servidor (balcão, saída ou interno). Admin, Gestor e Usuário; Leitor e Auditor nunca. */
export async function registrarProtocolo(ctx: CtxGed, entrada: unknown, anexos: AnexoEntrada[] = []): Promise<ResultadoCriacao> {
  if (!podeRegistrarProtocolo(ctx.membro.papel)) throw proibido("Seu papel não permite registrar protocolos.");
  const e: RegistroServidor = zRegistroServidor.parse(entrada);
  const interessado = e.livro === "INTERNO" ? null : e.interessado;
  if (e.livro === "ENTRADA" && !interessado) throw invalido("Informe o remetente.");
  const prazo = e.prazo_resposta ? new Date(e.prazo_resposta) : null;
  return criarProtocoloNaBase(ctx, {
    livro: e.livro, origem: "BALCAO", assunto: e.assunto, descricao: e.descricao ?? null, tipo_documento_id: e.tipo_documento_id ?? null,
    prioridade: e.prioridade, prazo_resposta_em: prazo,
    origem_setor_id: e.livro === "ENTRADA" ? null : e.origem_setor_id,
    interessado: interessado ? { nome: interessado.nome, cpf_cnpj: interessado.cpf_cnpj ?? null, email: interessado.email ?? null, telefone: interessado.telefone ?? null } : null,
    destino_setor_id: e.livro === "SAIDA" ? null : (e.destino_setor_id ?? null),
    destino_usuario_id: e.livro === "SAIDA" ? null : (e.destino_usuario_id ?? null),
    criado_por_id: ctx.usuario.id, consentimento_lgpd_em: null, anexos_com_dados_pessoais: false,
  }, anexos);
}

// ───────────────────────── Comprovante ─────────────────────────

export const urlVerificacaoProtocolo = (codigo: string, base: string = baseUrlApp()) => `${base.replace(/\/+$/, "")}/verificar/protocolo/${codigo}`;

async function tipoComprovante(tx: GedTx): Promise<string> {
  const nome = "Comprovante de protocolo";
  const t = await tx.gedTipoDocumento.findFirst({ where: { nome }, select: { id: true } });
  if (t) return t.id;
  return (await tx.gedTipoDocumento.create({ data: { nome } as Prisma.GedTipoDocumentoUncheckedCreateInput, select: { id: true } })).id;
}

export type ResultadoComprovante = { documento_id: string; versao_id: string; sha256: string; assinado: boolean; ja_emitido: boolean };

/**
 * Emite (uma única vez) o comprovante do protocolo: PDF com brasão/logo, número, data/hora de Brasília, interessado com CPF/CNPJ
 * MASCARADO, assunto, anexos com SHA-256, código de consulta e QR de verificação. Assinado em PAdES com o certificado A1 do
 * órgão quando houver; senão fica como assinatura eletrônica simples (o QR/código conferem a autenticidade). O PDF vira um
 * GedDocumento (origem COMPROVANTE) e o hash final fica gravado no protocolo (imutável depois de emitido).
 */
export async function emitirComprovanteProtocolo(ctx: CtxGed, protocoloId: string): Promise<ResultadoComprovante> {
  const p = exigirEncontrado(await ctx.db.gedProtocolo.findUnique({ where: { id: protocoloId } }), "Protocolo não encontrado.");
  if (p.comprovante_documento_id && p.comprovante_versao_id && p.comprovante_sha256) {
    return { documento_id: p.comprovante_documento_id, versao_id: p.comprovante_versao_id, sha256: p.comprovante_sha256, assinado: !!p.comprovante_assinado, ja_emitido: true };
  }
  const [anexos, org, cfg] = await Promise.all([
    ctx.db.gedProtocoloDocumento.findMany({ where: { protocolo_id: p.id, finalidade: "ANEXO" }, orderBy: { ordem: "asc" }, select: { nome_arquivo: true, sha256: true, tamanho: true } }),
    ctx.db.organizacao.findUnique({ where: { id: ctx.organizacao_id }, select: { nome: true, logo_url: true, slug_publico: true } }),
    ctx.db.gedConfig.findFirst({ select: { protocolo_portal_ativo: true } }),
  ]);
  const setores = await nomesSetores(ctx, [p.origem_setor_id, p.destino_setor_id]);
  const destinoUsuario = p.destino_usuario_id ? (await ctx.db.usuario.findFirst({ where: { id: p.destino_usuario_id, organizacao_id: ctx.organizacao_id }, select: { nome: true } }))?.nome ?? null : null;
  const i = lerInteressado(p);
  const emitido_em = new Date();
  const urlVer = urlVerificacaoProtocolo(p.codigo_verificacao);
  let cert = null;
  try {
    cert = await certificadoDoCliente(ctx, emitido_em);
  } catch (e) {
    console.error("[ged-protocolo] certificado do órgão indisponível; comprovante sem PAdES:", e instanceof Error ? e.message : e);
  }
  const portalAtivo = !!cfg?.protocolo_portal_ativo && !!org?.slug_publico;
  const html = htmlComprovante({
    organizacao: { nome: org?.nome ?? ctx.organizacao.nome, logo_data_uri: await imagemDataUri(logoProprio(org?.logo_url ?? ctx.organizacao.logo_url)).catch(() => null) },
    numero: p.numero, livro: p.livro, registrado_em: p.created_at, assunto: p.assunto,
    interessado: i.nome ? { nome: i.nome, doc_mascarado: docMascarado(i.cpf_cnpj) } : null,
    origem_rotulo: p.origem_setor_id ? setores.get(p.origem_setor_id) ?? null : null,
    destino_rotulo: [p.destino_setor_id ? setores.get(p.destino_setor_id) : null, destinoUsuario].filter(Boolean).join(" · ") || null,
    anexos: anexos.map((a) => ({ nome: a.nome_arquivo, sha256: a.sha256, tamanho: a.tamanho })),
    codigo_consulta: p.livro === "ENTRADA" && portalAtivo ? p.codigo_consulta : null,
    url_consulta: portalAtivo ? linkConsulta(org?.slug_publico ?? null, p.numero, p.codigo_consulta)?.replace(/\?.*$/, "") ?? null : null,
    codigo_verificacao: p.codigo_verificacao, url_verificacao: urlVer,
    qr_data_uri: `data:image/png;base64,${(await qrPng(urlVer)).toString("base64")}`,
    com_certificado: !!cert, emitido_em,
  });
  let pdf = await htmlParaPdf(html, { margem: "14mm" });
  let assinado = false;
  if (cert) {
    try {
      pdf = await assinarComCertificado(pdf, cert, { motivo: `Comprovante do protocolo ${p.numero}`, local: ctx.organizacao.nome, contato: urlVer, quando: emitido_em });
      assinado = true;
    } catch (e) {
      console.error("[ged-protocolo] falha ao assinar o comprovante; mantido sem PAdES:", e instanceof Error ? e.message : e);
    }
  }
  const out = await ctx.db.$transaction(async (tx) => {
    const trava = exigirEncontrado(await tx.gedProtocolo.update({ where: { id: p.id }, data: { updated_at: new Date() }, select: { comprovante_documento_id: true, comprovante_versao_id: true, comprovante_sha256: true, comprovante_assinado: true } }));
    if (trava.comprovante_documento_id && trava.comprovante_versao_id && trava.comprovante_sha256) {
      return { documento_id: trava.comprovante_documento_id, versao_id: trava.comprovante_versao_id, sha256: trava.comprovante_sha256, assinado: !!trava.comprovante_assinado, ja_emitido: true };
    }
    const doc = await criarDocumentoNaTransacao(tx, ctx, {
      titulo: `Comprovante de protocolo ${p.numero}`, tipo_id: await tipoComprovante(tx), sensibilidade: "RESTRITO", origem: "COMPROVANTE",
      arquivo: pdf, nome_arquivo: `comprovante-${p.numero}.pdf`, mime: "application/pdf", dados_pessoais: true, auditoria: { protocolo: p.numero },
    });
    await tx.gedProtocolo.update({
      where: { id: p.id },
      data: { comprovante_documento_id: doc.id, comprovante_versao_id: doc.versao_id, comprovante_sha256: doc.sha256, comprovante_emitido_em: emitido_em, comprovante_assinado: assinado },
    });
    await auditarGed(ctx, { acao: "GED_PROTOCOLO_COMPROVANTE_EMITIDO", entidade: "ged_protocolo", entidade_id: p.id, depois: { numero: p.numero, documento_id: doc.id, sha256: doc.sha256, assinado_pades: assinado } }, tx);
    return { documento_id: doc.id, versao_id: doc.versao_id, sha256: doc.sha256, assinado, ja_emitido: false };
  }, TX_OPC);
  if (!out.ja_emitido) void iniciarExtracaoAposUpload(ctx.organizacao_id, out.versao_id).catch(() => {});
  return out;
}

/** Bytes do comprovante já emitido (sempre pelo cliente da sessão/portal; nunca por URL pública do storage). */
export async function lerComprovante(ctx: Pick<CtxGed, "db" | "organizacao_id">, protocoloId: string): Promise<{ buffer: Buffer; nome: string; sha256: string } | null> {
  const p = await ctx.db.gedProtocolo.findUnique({ where: { id: protocoloId }, select: { numero: true, comprovante_versao_id: true, comprovante_sha256: true } });
  if (!p?.comprovante_versao_id) return null;
  const v = await ctx.db.gedVersaoDocumento.findUnique({ where: { id: p.comprovante_versao_id }, select: { storage_key: true, sha256: true } });
  if (!v) return null;
  const buffer = await lerArquivoGed(ctx.organizacao_id, v.storage_key);
  if (createHash("sha256").update(buffer).digest("hex") !== v.sha256) throw new ErroApi(409, "INTEGRIDADE", "O arquivo do comprovante não confere com o hash registrado.");
  return { buffer, nome: `comprovante-${p.numero}.pdf`, sha256: v.sha256 };
}

// ───────────────────────── Consultas internas ─────────────────────────

async function nomesSetores(ctx: Pick<CtxGed, "db">, ids: (string | null)[]): Promise<Map<string, string>> {
  const l = [...new Set(ids.filter((x): x is string => !!x))];
  if (!l.length) return new Map();
  return new Map((await ctx.db.gedSetor.findMany({ where: { id: { in: l } }, select: { id: true, nome: true } })).map((s) => [s.id, s.nome]));
}
async function nomesUsuarios(ctx: Pick<CtxGed, "db" | "organizacao_id">, ids: (string | null)[]): Promise<Map<string, string>> {
  const l = [...new Set(ids.filter((x): x is string => !!x))];
  if (!l.length) return new Map();
  return new Map((await ctx.db.usuario.findMany({ where: { id: { in: l }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
}

export type FiltrosProtocolo = {
  livro: GedLivroProtocolo | null;
  ano: number | null;
  situacao: GedSituacaoProtocolo | null;
  setor_id: string | null;
  q: string | null;
  meus: boolean;
  page: number;
};
const TAMANHO_PAGINA = 20;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerFiltrosProtocolo(sp: URLSearchParams | Record<string, string | string[] | undefined>): FiltrosProtocolo {
  const um = (k: string): string | null => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : null;
  };
  const livro = um("livro");
  const sit = um("situacao");
  const ano = Number(um("ano"));
  const page = Math.max(1, Math.floor(Number(um("page")) || 1));
  const setor = um("setor");
  return {
    livro: livro === "ENTRADA" || livro === "SAIDA" || livro === "INTERNO" ? livro : null,
    ano: Number.isInteger(ano) && ano >= 2000 && ano <= 2999 ? ano : null,
    situacao: sit && ["RECEBIDO", "EM_ANALISE", "ENCAMINHADO", "RESPONDIDO", "ARQUIVADO", "INDEFERIDO", "DEVOLVIDO"].includes(sit) ? (sit as GedSituacaoProtocolo) : null,
    setor_id: setor && RE_UUID.test(setor) ? setor : null,
    q: (um("q") ?? "").slice(0, 120) || null,
    meus: um("meus") === "1",
    page,
  };
}

export function filtrosParaQueryProtocolo(f: FiltrosProtocolo, extra: Partial<FiltrosProtocolo> = {}): string {
  const g = { ...f, ...extra };
  const q = new URLSearchParams();
  if (g.livro) q.set("livro", g.livro);
  if (g.ano) q.set("ano", String(g.ano));
  if (g.situacao) q.set("situacao", g.situacao);
  if (g.setor_id) q.set("setor", g.setor_id);
  if (g.q) q.set("q", g.q);
  if (g.meus) q.set("meus", "1");
  if (g.page > 1) q.set("page", String(g.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function whereFiltrosProtocolo(a: AtorProtocolo, f: FiltrosProtocolo): Prisma.GedProtocoloWhereInput {
  const and: Prisma.GedProtocoloWhereInput[] = [whereProtocoloVisivel(a)];
  if (f.meus) and.push(whereProtocoloEnvolvido(a));
  if (f.livro) and.push({ livro: f.livro });
  if (f.ano) and.push({ ano: f.ano });
  if (f.situacao) and.push({ situacao: f.situacao });
  if (f.setor_id) and.push({ OR: [{ destino_setor_id: f.setor_id }, { setor_atual_id: f.setor_id }, { origem_setor_id: f.setor_id }] });
  if (f.q) {
    const digitos = f.q.replace(/\D/g, "");
    const cpfCnpj = digitos.length === 11 || digitos.length === 14 ? [{ interessado_doc_hash: hashDocumento(digitos) }] : [];
    and.push({ OR: [{ numero: { contains: f.q, mode: "insensitive" } }, { assunto: { contains: f.q, mode: "insensitive" } }, { descricao: { contains: f.q, mode: "insensitive" } }, ...cpfCnpj] });
  }
  return { AND: and };
}

export type LinhaProtocolo = {
  id: string; numero: string; livro: GedLivroProtocolo; created_at: Date; assunto: string; situacao: GedSituacaoProtocolo; situacao_rotulo: string;
  prioridade: "BAIXA" | "NORMAL" | "ALTA" | "URGENTE"; prazo_resposta_em: Date | null; semaforo: Semaforo;
  interessado: string | null; com: string | null; origem: "BALCAO" | "PORTAL";
};
export type PaginaProtocolos = { linhas: LinhaProtocolo[]; total: number; page: number; size: number };

export async function listarProtocolos(ctx: CtxGed, f: FiltrosProtocolo): Promise<PaginaProtocolos> {
  const where = whereFiltrosProtocolo(ator(ctx), f);
  const [total, rows] = await Promise.all([
    ctx.db.gedProtocolo.count({ where }),
    ctx.db.gedProtocolo.findMany({ where, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: (f.page - 1) * TAMANHO_PAGINA, take: TAMANHO_PAGINA }),
  ]);
  const [setores, usuarios] = await Promise.all([
    nomesSetores(ctx, rows.flatMap((r) => [r.setor_atual_id, r.origem_setor_id])),
    nomesUsuarios(ctx, rows.map((r) => r.responsavel_id)),
  ]);
  return {
    total, page: f.page, size: TAMANHO_PAGINA,
    linhas: rows.map((r) => {
      const i = lerInteressado(r);
      const com = [r.setor_atual_id ? setores.get(r.setor_atual_id) : null, r.responsavel_id ? usuarios.get(r.responsavel_id) : null].filter(Boolean).join(" · ");
      return {
        id: r.id, numero: r.numero, livro: r.livro, created_at: r.created_at, assunto: r.assunto, situacao: r.situacao, situacao_rotulo: rotuloSituacao(r.situacao, r.livro),
        prioridade: r.prioridade, prazo_resposta_em: r.prazo_resposta_em,
        semaforo: r.prazo_resposta_em && !situacaoConclui(r.situacao) ? semaforo(r.prazo_resposta_em, 3) : "cinza",
        interessado: i.nome ?? (r.origem_setor_id ? setores.get(r.origem_setor_id) ?? null : null), com: com || null, origem: r.origem,
      };
    }),
  };
}

export type EventoView = { id: string; created_at: Date; tipo: string; rotulo: string; situacao_para: GedSituacaoProtocolo; situacao_rotulo: string; autor: string | null; destino: string | null; texto: string | null; texto_publico: string | null };
export type AnexoView = { documento_id: string; versao_id: string; nome: string; tamanho: number; sha256: string; finalidade: string; ordem: number; evento_id: string | null; visivel: boolean; numero?: string; titulo?: string };
export type FichaProtocolo = {
  id: string; numero: string; livro: GedLivroProtocolo; ano: number; created_at: Date; origem: "BALCAO" | "PORTAL"; assunto: string; descricao: string | null;
  tipo_documento: string | null; prioridade: "BAIXA" | "NORMAL" | "ALTA" | "URGENTE"; prazo_resposta_em: Date | null; semaforo: Semaforo;
  situacao: GedSituacaoProtocolo; situacao_rotulo: string; concluido_em: Date | null;
  interessado: { nome: string | null; cpf_cnpj: string | null; email: string | null; telefone: string | null } | null;
  origem_setor: string | null; destino_setor: string | null; destino_usuario: string | null; setor_atual: string | null; responsavel: string | null; criado_por: string | null;
  consentimento_lgpd_em: Date | null;
  codigo_consulta: string | null; codigo_verificacao: string;
  comprovante: { emitido: boolean; sha256: string | null; emitido_em: Date | null; assinado: boolean; documento_id: string | null };
  eventos: EventoView[]; anexos: AnexoView[];
  pode_agir: boolean; acoes: readonly AcaoProtocolo[];
};

/** Carrega o protocolo se o ator pode ver (senão 404, como nos documentos). Devolve também se pode agir. */
export async function carregarProtocolo(ctx: CtxGed, id: string) {
  if (!RE_UUID.test(id)) throw naoEncontrado("Protocolo não encontrado.");
  const p = await ctx.db.gedProtocolo.findUnique({ where: { id } });
  if (!p || !podeVerProtocolo(ator(ctx), p)) throw naoEncontrado("Protocolo não encontrado.");
  return { p, agir: podeAgirNoProtocolo(ator(ctx), p) };
}

export async function obterProtocolo(ctx: CtxGed, id: string): Promise<FichaProtocolo> {
  const { p, agir } = await carregarProtocolo(ctx, id);
  const [eventos, vinculos, tipo] = await Promise.all([
    ctx.db.gedProtocoloEvento.findMany({ where: { protocolo_id: p.id }, orderBy: [{ created_at: "asc" }, { id: "asc" }] }),
    ctx.db.gedProtocoloDocumento.findMany({ where: { protocolo_id: p.id }, orderBy: { ordem: "asc" } }),
    p.tipo_documento_id ? ctx.db.gedTipoDocumento.findUnique({ where: { id: p.tipo_documento_id }, select: { nome: true } }) : null,
  ]);
  const setores = await nomesSetores(ctx, [p.origem_setor_id, p.destino_setor_id, p.setor_atual_id, ...eventos.map((e) => e.para_setor_id)]);
  const usuarios = await nomesUsuarios(ctx, [p.destino_usuario_id, p.responsavel_id, p.criado_por_id, ...eventos.flatMap((e) => [e.usuario_id, e.para_usuario_id])]);
  // Anexos: o vínculo é do protocolo, mas abrir o documento segue a permissão do documento (whereGedVisivel – sigilo).
  const visiveis = vinculos.length
    ? await ctx.db.gedDocumento.findMany({ where: { AND: [{ id: { in: vinculos.map((v) => v.documento_id) } }, await whereGedVisivel(ctx, "VER")] }, select: { id: true, numero: true, titulo: true } })
    : [];
  const doc = new Map(visiveis.map((d) => [d.id, d]));
  const i = lerInteressado(p);
  const completo = agir;
  return {
    id: p.id, numero: p.numero, livro: p.livro, ano: p.ano, created_at: p.created_at, origem: p.origem, assunto: p.assunto, descricao: p.descricao,
    tipo_documento: tipo?.nome ?? null, prioridade: p.prioridade, prazo_resposta_em: p.prazo_resposta_em,
    semaforo: p.prazo_resposta_em && !situacaoConclui(p.situacao) ? semaforo(p.prazo_resposta_em, 3) : "cinza",
    situacao: p.situacao, situacao_rotulo: rotuloSituacao(p.situacao, p.livro), concluido_em: p.concluido_em,
    interessado: p.livro === "INTERNO" ? null : { nome: i.nome, cpf_cnpj: completo ? i.cpf_cnpj : docMascarado(i.cpf_cnpj), email: completo ? i.email : null, telefone: completo ? i.telefone : null },
    origem_setor: p.origem_setor_id ? setores.get(p.origem_setor_id) ?? null : null,
    destino_setor: p.destino_setor_id ? setores.get(p.destino_setor_id) ?? null : null,
    destino_usuario: p.destino_usuario_id ? usuarios.get(p.destino_usuario_id) ?? null : null,
    setor_atual: p.setor_atual_id ? setores.get(p.setor_atual_id) ?? null : null,
    responsavel: p.responsavel_id ? usuarios.get(p.responsavel_id) ?? null : null,
    criado_por: p.criado_por_id ? usuarios.get(p.criado_por_id) ?? null : null,
    consentimento_lgpd_em: p.consentimento_lgpd_em,
    codigo_consulta: completo && p.livro === "ENTRADA" ? p.codigo_consulta : null,
    codigo_verificacao: p.codigo_verificacao,
    comprovante: { emitido: !!p.comprovante_sha256, sha256: p.comprovante_sha256, emitido_em: p.comprovante_emitido_em, assinado: !!p.comprovante_assinado, documento_id: p.comprovante_documento_id },
    eventos: eventos.map((e) => ({
      id: e.id, created_at: e.created_at, tipo: e.tipo, rotulo: rotuloPublicoEvento(e.tipo, p.livro), situacao_para: e.situacao_para, situacao_rotulo: rotuloSituacao(e.situacao_para, p.livro),
      autor: e.usuario_id ? usuarios.get(e.usuario_id) ?? "Usuário" : p.origem === "PORTAL" && e.tipo === "REGISTRO" ? "Interessado (portal)" : null,
      destino: [e.para_setor_id ? setores.get(e.para_setor_id) : null, e.para_usuario_id ? usuarios.get(e.para_usuario_id) : null].filter(Boolean).join(" · ") || null,
      texto: e.texto, texto_publico: e.texto_publico,
    })),
    anexos: vinculos.map((v) => {
      const d = doc.get(v.documento_id);
      return { documento_id: v.documento_id, versao_id: v.versao_id, nome: d ? v.nome_arquivo : "Anexo restrito", tamanho: v.tamanho, sha256: v.sha256, finalidade: v.finalidade, ordem: v.ordem, evento_id: v.evento_id, visivel: !!d, numero: d?.numero, titulo: d?.titulo };
    }),
    pode_agir: agir,
    acoes: agir ? acoesDisponiveis(p.situacao) : [],
  };
}

function acoesDisponiveis(s: GedSituacaoProtocolo): readonly AcaoProtocolo[] {
  return (["ANALISAR", "ENCAMINHAR", "RESPONDER", "ARQUIVAR", "DEVOLVER", "INDEFERIR"] as const).filter((a) => proximaSituacao(s, a));
}

export type OpcoesProtocolo = { setores: { id: string; nome: string; sigla: string }[]; usuarios: { id: string; nome: string; cargo: string | null }[]; tipos: { id: string; nome: string }[] };
/** Setores, pessoas aptas a receber e tipos de documento para os formulários. */
export async function opcoesProtocolo(ctx: CtxGed): Promise<OpcoesProtocolo> {
  const [setores, membros, tipos] = await Promise.all([
    ctx.db.gedSetor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, sigla: true } }),
    ctx.db.gedMembro.findMany({ where: { ativo: true, papel: { in: ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"] }, usuario: { is: { ativo: true, organizacao_id: ctx.organizacao_id } } }, select: { usuario: { select: { id: true, nome: true, cargo: true } } } }),
    ctx.db.gedTipoDocumento.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  return { setores, tipos, usuarios: membros.map((m) => m.usuario).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) };
}

// ───────────────────────── Ações (andamento) ─────────────────────────

export type ResultadoAcao = { situacao: GedSituacaoProtocolo; evento_id: string; documentos_movidos?: number };

/**
 * Movimenta o protocolo: iniciar análise, encaminhar, responder, arquivar, devolver ou indeferir. Exige poder agir (Admin/Gestor
 * em qualquer protocolo; Usuário nos que está envolvido). Cada ação grava um evento imutável, atualiza a situação e avisa o
 * interessado externo por e-mail. Responder aceita um PDF de resposta (vira documento + anexo RESPOSTA).
 * Devolver e indeferir exigem justificativa; responder, devolver e indeferir mostram o texto ao interessado.
 */
export async function executarAcaoProtocolo(ctx: CtxGed, id: string, entrada: unknown, anexo?: AnexoEntrada | null): Promise<ResultadoAcao> {
  const e: EntradaAcaoProtocolo = zAcaoProtocolo.parse(entrada);
  const { p, agir } = await carregarProtocolo(ctx, id);
  if (!agir) throw proibido("Você não pode movimentar este protocolo.");
  const nova = proximaSituacao(p.situacao, e.acao);
  if (!nova) throw new ErroApi(409, "SITUACAO_INVALIDA", `Não é possível ${ROTULO_ACAO_PROTOCOLO[e.acao].toLowerCase()}: o protocolo está ${rotuloSituacao(p.situacao, p.livro).toLowerCase()}.`);
  if (anexo && e.acao !== "RESPONDER") throw invalido("Só a resposta aceita arquivo anexo.");
  const arq = anexo ? exigirUploadGedValido(anexo.arquivo, anexo.nome_arquivo, anexo.mime) : null;
  let destinoRotulo: string | null = null;
  if (e.acao === "ENCAMINHAR") {
    const dest = await resolverDestinatario(ctx.db, ctx, { usuario_id: e.destino_usuario_id ?? null, setor_id: e.destino_setor_id ?? null });
    destinoRotulo = dest.rotulo;
  }
  const publico = ACOES_COM_TEXTO_PUBLICO.includes(e.acao);

  return ctx.db.$transaction(async (tx) => {
    // Trava a linha: duas ações simultâneas se enfileiram e a segunda enxerga a situação nova.
    const atual = exigirEncontrado(await tx.gedProtocolo.update({ where: { id: p.id }, data: { updated_at: new Date() } }), "Protocolo não encontrado.");
    if (atual.situacao !== p.situacao) throw new ErroApi(409, "CONFLITO", "O protocolo foi movimentado por outra pessoa. Atualize a página.");
    const ev = await tx.gedProtocoloEvento.create({
      data: {
        protocolo_id: p.id, tipo: TIPO_EVENTO_DA_ACAO[e.acao], situacao_de: p.situacao, situacao_para: nova, usuario_id: ctx.usuario.id,
        para_setor_id: e.acao === "ENCAMINHAR" ? e.destino_setor_id ?? null : null, para_usuario_id: e.acao === "ENCAMINHAR" ? e.destino_usuario_id ?? null : null,
        texto: e.texto || null, texto_publico: publico ? e.texto || null : null,
      } as Prisma.GedProtocoloEventoUncheckedCreateInput,
      select: { id: true },
    });
    const dados: Prisma.GedProtocoloUncheckedUpdateInput = { situacao: nova };
    if (e.acao === "ENCAMINHAR") {
      dados.setor_atual_id = e.destino_setor_id ?? null;
      dados.responsavel_id = e.destino_usuario_id ?? null;
    }
    if (e.acao === "ANALISAR") dados.responsavel_id = ctx.usuario.id;
    if (situacaoConclui(nova) && !atual.concluido_em) dados.concluido_em = new Date();
    const depois = await tx.gedProtocolo.update({ where: { id: p.id }, data: dados, select: { id: true, numero: true, livro: true, situacao: true, interessado_email_cifrado: true } });

    let movidos = 0;
    if (e.acao === "ENCAMINHAR") {
      const vinc = await tx.gedProtocoloDocumento.findMany({ where: { protocolo_id: p.id }, select: { documento_id: true } });
      if (vinc.length) {
        const mins = (await Promise.all(vinc.map((v) => carregarDocumentoMin(ctx, v.documento_id)))).filter((m): m is NonNullable<typeof m> => !!m);
        const acoes = await acoesDosDocumentos(ctx, mins, { semMemo: true });
        for (const m of mins) {
          if (!acoes.get(m.id)?.includes("TRAMITAR")) continue; // sem TRAMITAR no documento (sigilo/ACL): o protocolo muda, o arquivo não
          try {
            await registrarTramite(tx, ctx, {
              documento_id: m.id, tipo: "ENVIO", para_setor_id: e.destino_setor_id, para_usuario_id: e.destino_usuario_id,
              despacho: (e.texto ? `Protocolo ${p.numero}: ${e.texto}` : `Protocolo ${p.numero}: ${p.assunto}`).slice(0, 500),
            });
            movidos++;
          } catch (err) {
            if (!(err instanceof ErroApi)) throw err;
          }
        }
      }
    }
    if (arq && anexo) {
      const ordem = (await tx.gedProtocoloDocumento.count({ where: { protocolo_id: p.id } })) + 1;
      const doc = await criarDocumentoNaTransacao(tx, ctx, {
        titulo: `${p.numero} – Resposta – ${semExt(arq.nome)}`, tipo_id: p.tipo_documento_id, sensibilidade: "RESTRITO",
        arquivo: anexo.arquivo, nome_arquivo: anexo.nome_arquivo, mime: anexo.mime, auditoria: { protocolo: p.numero, finalidade: "RESPOSTA" },
      });
      await tx.gedProtocoloDocumento.create({
        data: { protocolo_id: p.id, documento_id: doc.id, versao_id: doc.versao_id, evento_id: ev.id, finalidade: "RESPOSTA", nome_arquivo: doc.nome_arquivo, tamanho: doc.tamanho, sha256: doc.sha256, ordem } as Prisma.GedProtocoloDocumentoUncheckedCreateInput,
      });
    }
    await auditarGed(ctx, {
      acao: `GED_PROTOCOLO_${TIPO_EVENTO_DA_ACAO[e.acao]}`, entidade: "ged_protocolo", entidade_id: p.id,
      antes: { situacao: p.situacao }, depois: { numero: p.numero, situacao: nova, evento_id: ev.id, destino: destinoRotulo, documentos_movidos: movidos, com_arquivo: !!arq },
    }, tx);
    if (notificaInteressado(TIPO_EVENTO_DA_ACAO[e.acao])) await enfileirarAvisoInteressado(tx, depois, "PROTOCOLO_SITUACAO");
    return { situacao: nova, evento_id: ev.id, documentos_movidos: movidos };
  }, TX_OPC);
}
