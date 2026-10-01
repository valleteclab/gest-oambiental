import "server-only";
import type { CategoriaAto, DocumentoOficial, TipoDocumento } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../audit";
import { emitirDocumento } from "../documentos";
import type { UsuarioSessao } from "../rbac";
import { formatarEndereco } from "../cadastros/validacao";
import { ehDemandaUrbana, lerDadosDemanda, paresDemanda, resumoVistoriaPoda, validadeDemanda } from "../demandas/catalogo";

// Emissão dos documentos oficiais do processo – SEMPRE fora da transação (geração de PDF é lenta).
// Falhas não desfazem a transição: o processo fica no estado e a ação "Emitir documento" permite nova tentativa.

export function tipoDocumentoDoAto(categoria: CategoriaAto): TipoDocumento {
  if (categoria === "LICENCA") return "LICENCA";
  if (categoria === "AUTORIZACAO") return "AUTORIZACAO";
  return "CERTIDAO"; // CERTIDAO e DECLARACAO
}

export function somarMeses(d: Date, meses: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + meses);
  return r;
}

async function carregar(processoId: string) {
  return prisma.processo.findUniqueOrThrow({
    where: { id: processoId },
    include: {
      municipio: true,
      tipo_ato: true,
      requerente: { select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true } },
      empreendimento: { include: { tipologia: true } },
      rt: { include: { pessoa: { select: { nome: true } } } },
      condicionantes: { where: { status: { not: "CANCELADA" } }, orderBy: { created_at: "asc" } },
      pareceres: { orderBy: { created_at: "desc" }, take: 1 },
      anexos: { select: { nome_arquivo: true, tipo: true, sha256: true }, orderBy: { created_at: "asc" } },
    },
  });
}

/** Dados comuns do processo enviados ao modelo (o módulo de documentos também monta seu contexto a partir do banco). */
async function dadosBase(processoId: string) {
  const p = await carregar(processoId);
  const e = p.empreendimento;
  return {
    p,
    dados: {
      processo: { numero: p.numero, data_protocolo: p.data_protocolo, descricao_atividade: p.descricao_atividade, tipo_ato_sigla: p.tipo_ato.sigla, tipo_ato_nome: p.tipo_ato.nome },
      requerente: { nome: p.requerente.nome, tipo: p.requerente.tipo, documento_mascarado: p.requerente.cpf_cnpj_mascara },
      empreendimento: {
        nome: e.nome,
        endereco: formatarEndereco(e.endereco),
        latitude: e.latitude?.toString() ?? null,
        longitude: e.longitude?.toString() ?? null,
        area_m2: e.area_m2?.toString() ?? null,
        numero_car: e.numero_car,
      },
      tipologia: `${e.tipologia.codigo} – ${e.tipologia.descricao}`,
      porte: e.porte,
      potencial_poluidor: e.potencial_poluidor,
      rt: p.rt ? { nome: p.rt.pessoa.nome, registro: `${p.rt.conselho} ${p.rt.registro_conselho}/${p.rt.uf_conselho}`, formacao: p.rt.formacao } : null,
      condicionantes: p.condicionantes.map((c) => ({ descricao: c.descricao, periodicidade: c.periodicidade, prazo_ate: c.prazo_ate })),
    } as Record<string, unknown>,
  };
}

async function existente(processoId: string, tipos: TipoDocumento[]) {
  return prisma.documentoOficial.findFirst({ where: { processo_id: processoId, tipo: { in: tipos }, status: "VALIDO" }, orderBy: { emitido_em: "desc" } });
}

/** Recibo de protocolo (idempotente). */
export async function emitirRecibo(processoId: string, usuario: UsuarioSessao): Promise<DocumentoOficial> {
  const ja = await existente(processoId, ["RECIBO"]);
  if (ja) return ja;
  const { p, dados } = await dadosBase(processoId);
  return emitirDocumento({
    tipo: "RECIBO",
    municipio_id: p.municipio_id,
    processo_id: p.id,
    titular_id: p.requerente_id,
    dados: { ...dados, anexos: p.anexos.map((a) => ({ nome: a.nome_arquivo, tipo: a.tipo, sha256: a.sha256 })), texto: `Recibo de protocolo do processo ${p.numero}` },
    usuario,
  });
}

/** PDF do parecer técnico (idempotente por parecer). */
export async function emitirPdfParecer(parecerId: string, usuario: UsuarioSessao): Promise<DocumentoOficial> {
  const par = await prisma.parecer.findUniqueOrThrow({ where: { id: parecerId } });
  if (par.documento_id) {
    const d = await prisma.documentoOficial.findUnique({ where: { id: par.documento_id } });
    if (d) return d;
  }
  const autor = await prisma.usuario.findUnique({ where: { id: par.autor_id }, select: { nome: true } });
  const { p, dados } = await dadosBase(par.processo_id);
  const doc = await emitirDocumento({
    tipo: "PARECER",
    municipio_id: p.municipio_id,
    processo_id: p.id,
    titular_id: p.requerente_id,
    numero: par.numero,
    dados: { ...dados, parecer: { numero: par.numero, conclusao: par.conclusao, texto_html: par.texto_html, autor: autor?.nome ?? null } },
    usuario,
  });
  await prisma.parecer.update({ where: { id: par.id }, data: { documento_id: doc.id } });
  await auditar({ usuario_id: usuario.id, acao: "VINCULAR_DOCUMENTO", entidade: "parecer", entidade_id: par.id, depois: { documento_id: doc.id } });
  return doc;
}

/** Documento da decisão: licença/autorização/certidão (DEFERIDO) ou ofício de indeferimento (INDEFERIDO). Idempotente. */
export async function emitirDocumentoDecisao(processoId: string, usuario: UsuarioSessao, motivoIndeferimento?: string | null): Promise<DocumentoOficial> {
  const { p, dados } = await dadosBase(processoId);
  if (p.status !== "DEFERIDO" && p.status !== "INDEFERIDO") throw new Error("Processo sem decisão pendente de documento.");
  const parecer = p.pareceres[0] ?? null;
  const parecerDados = parecer ? { numero: parecer.numero, conclusao: parecer.conclusao, texto_html: parecer.texto_html } : null;

  if (p.status === "INDEFERIDO") {
    const ja = await existente(p.id, ["OFICIO"]);
    if (ja) return ja;
    let motivo = motivoIndeferimento;
    if (!motivo) {
      const t = await prisma.tramitacao.findFirst({ where: { processo_id: p.id, acao: "indeferir" }, orderBy: { created_at: "desc" } });
      motivo = t?.despacho ?? null;
    }
    return emitirDocumento({
      tipo: "OFICIO",
      municipio_id: p.municipio_id,
      processo_id: p.id,
      titular_id: p.requerente_id,
      dados: { ...dados, parecer: parecerDados, motivo, assunto: `Indeferimento do requerimento de ${p.tipo_ato.nome}`, texto: motivo },
      usuario,
    });
  }

  const tipo = tipoDocumentoDoAto(p.tipo_ato.categoria);
  const ja = await existente(p.id, [tipo]);
  if (ja) return ja;
  let validade = p.tipo_ato.validade_meses_padrao ? somarMeses(new Date(), p.tipo_ato.validade_meses_padrao) : null;
  const demanda = await dadosDemandaDocumento(p);
  if (demanda?.validade) validade = demanda.validade;
  const doc = await emitirDocumento({
    tipo,
    municipio_id: p.municipio_id,
    processo_id: p.id,
    titular_id: p.requerente_id,
    sigla_ato: p.tipo_ato.sigla,
    validade_ate: validade,
    dados: { ...dados, parecer: parecerDados, validade_meses: p.tipo_ato.validade_meses_padrao, ...(demanda ? { demanda: demanda.dados } : {}) },
    usuario,
  });
  // Condicionantes passam a integrar o documento emitido
  if (p.condicionantes.length) {
    await prisma.condicionante.updateMany({ where: { processo_id: p.id, documento_id: null, status: { not: "CANCELADA" } }, data: { documento_id: doc.id } });
    await auditar({ usuario_id: usuario.id, acao: "VINCULAR_DOCUMENTO", entidade: "condicionante", entidade_id: p.id, depois: { documento_id: doc.id, quantidade: p.condicionantes.length } });
  }
  return doc;
}

/**
 * Demandas urbanas (APC/ASE/ACS): campos do pedido (texto estruturado em descricao_atividade), resultado da vistoria
 * (checklist – espécie, DAP, recomendação, nº de mudas da compensação) e validade específica (fim do evento / 30–90 dias).
 * Vai em `dados.demanda` do documento (templates/autorizacao-poda.ts e autorizacao-som.ts).
 */
async function dadosDemandaDocumento(p: Awaited<ReturnType<typeof carregar>>) {
  const sigla = p.tipo_ato.sigla;
  if (!ehDemandaUrbana(sigla)) return null;
  const lido = lerDadosDemanda(p.descricao_atividade);
  const campos = lido?.sigla === sigla ? lido.dados : {};
  const preenchido = p.tipo_ato.checklist_modelo_id
    ? await prisma.checklistPreenchido.findFirst({ where: { processo_id: p.id, checklist_modelo_id: p.tipo_ato.checklist_modelo_id }, orderBy: { updated_at: "desc" } })
    : null;
  const respostas = (preenchido?.respostas as Record<string, unknown>) ?? {};
  return {
    validade: validadeDemanda(sigla, campos, new Date()),
    dados: {
      sigla,
      campos,
      pares: paresDemanda(sigla, campos),
      descricao_livre: lido?.livre ?? p.descricao_atividade ?? null,
      vistoria: sigla === "APC" ? resumoVistoriaPoda(respostas) : null,
      limite_db: sigla !== "APC" && respostas.s5 !== null && respostas.s5 !== undefined && String(respostas.s5).trim() !== "" ? Number(respostas.s5) : null,
    },
  };
}

/** Executa uma emissão sem propagar erro (o stub/Chromium podem falhar). */
export async function tentarEmitir<T>(fn: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false; erro: string }> {
  try {
    return { ok: true, valor: await fn() };
  } catch (e) {
    console.error("[processo] falha ao emitir documento:", e);
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
