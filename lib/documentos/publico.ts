import "server-only";
import type { Prisma, TipoDocumento } from "@prisma/client";
import { prisma } from "../db";
import { hashBusca, somenteDigitos } from "../crypto";
import { urlValidacao } from "./emitir";
import { normalizarCodigo, ROTULO_TIPO_DOCUMENTO, statusPublico, TIPOS_PUBLICOS, titularPublico, type StatusPublico } from "./render";

// Consultas do PORTAL PÚBLICO (sem login). Nunca retornar CPF/CNPJ completo, e-mail, telefone ou despachos.

export type DocumentoPublico = {
  tipo: TipoDocumento;
  tipo_rotulo: string;
  titulo: string;
  numero: string;
  sigla_ato: string | null;
  codigo_verificador: string;
  status: StatusPublico;
  motivo_cancelamento: string | null;
  cancelado_em: Date | null;
  substituto: { numero: string; codigo_verificador: string } | null;
  titular: { nome: string; documento: string } | null;
  empreendimento: string | null;
  municipio: string;
  orgao: string;
  processo_numero: string | null;
  emitido_em: Date;
  emitido_por: string;
  validade_ate: Date | null;
  sha256_pdf: string;
  url_validacao: string;
  /** Link de download do PDF (somente licenças/autorizações/certidões válidas). */
  pdf_publico: boolean;
  id: string;
};

type Ctx = { titulo?: string; empreendimento?: { nome?: string } | null };

export async function documentoPorCodigo(codigoBruto: string): Promise<DocumentoPublico | null> {
  const codigo = normalizarCodigo(codigoBruto);
  if (!codigo) return null;
  const d = await prisma.documentoOficial.findUnique({
    where: { codigo_verificador: codigo },
    include: { municipio: true, processo: { select: { numero: true, empreendimento: { select: { nome: true } } } }, fiscalizacao: { select: { empreendimento: { select: { nome: true } } } } },
  });
  if (!d) return null;
  const [titular, substituto] = await Promise.all([
    d.titular_id ? prisma.pessoa.findUnique({ where: { id: d.titular_id }, select: { tipo: true, nome: true, cpf_cnpj_mascara: true } }) : null,
    d.substituto_id ? prisma.documentoOficial.findUnique({ where: { id: d.substituto_id }, select: { numero: true, codigo_verificador: true } }) : null,
  ]);
  const ctx = ((d.dados as Record<string, unknown> | null)?._contexto ?? {}) as Ctx;
  const status = statusPublico(d);
  return {
    id: d.id,
    tipo: d.tipo,
    tipo_rotulo: ROTULO_TIPO_DOCUMENTO[d.tipo] ?? d.tipo,
    titulo: ctx.titulo ?? ROTULO_TIPO_DOCUMENTO[d.tipo] ?? d.tipo,
    numero: d.numero,
    sigla_ato: d.sigla_ato,
    codigo_verificador: d.codigo_verificador,
    status,
    motivo_cancelamento: d.status === "VALIDO" ? null : d.motivo_cancelamento,
    cancelado_em: d.cancelado_em,
    substituto,
    titular: titularPublico(titular),
    empreendimento: d.processo?.empreendimento?.nome ?? d.fiscalizacao?.empreendimento?.nome ?? ctx.empreendimento?.nome ?? null,
    municipio: d.municipio.nome,
    orgao: d.municipio.orgao_ambiental_nome,
    processo_numero: d.processo?.numero ?? null,
    emitido_em: d.emitido_em,
    emitido_por: d.emitido_por_nome + (d.emitido_por_cargo ? ` – ${d.emitido_por_cargo}` : ""),
    validade_ate: d.validade_ate,
    sha256_pdf: d.sha256_pdf,
    url_validacao: urlValidacao(d.codigo_verificador),
    pdf_publico: status === "VALIDO" && (TIPOS_PUBLICOS as readonly string[]).includes(d.tipo),
  };
}

// ───────────── /consulta ─────────────

const ROTULO_ACAO: Record<string, string> = {
  protocolar: "Requerimento protocolado",
  distribuir: "Processo distribuído para análise",
  triar: "Triagem",
  aceitar: "Documentação aceita – análise técnica iniciada",
  pendencia: "Pendência aberta – ação do requerente necessária",
  responder: "Pendência respondida pelo requerente",
  agendar: "Vistoria agendada",
  agendar_vistoria: "Vistoria agendada",
  vistoria: "Vistoria realizada",
  concluir_vistoria: "Vistoria realizada",
  parecer: "Parecer técnico emitido",
  deferir: "Requerimento deferido",
  indeferir: "Requerimento indeferido",
  emitir_documento: "Documento emitido",
  concluir: "Processo concluído",
  arquivar: "Processo arquivado",
  arquivar_automatico: "Processo arquivado por decurso de prazo",
};

const ROTULO_STATUS_PUBLICO_PROC: Record<string, string> = {
  RASCUNHO: "Rascunho",
  PROTOCOLADO: "Protocolado",
  EM_TRIAGEM: "Em triagem",
  AGUARDANDO_REQUERENTE: "Pendência – ação do requerente",
  EM_ANALISE: "Em análise técnica",
  AGUARDANDO_VISTORIA: "Aguardando vistoria",
  AGUARDANDO_DECISAO: "Aguardando decisão",
  DEFERIDO: "Deferido",
  INDEFERIDO: "Indeferido",
  CONCLUIDO: "Concluído",
  ARQUIVADO: "Arquivado",
};

export function rotuloEtapaPublica(acao: string, paraStatus: string): string {
  const a = acao?.toLowerCase?.() ?? "";
  return ROTULO_ACAO[a] ?? ROTULO_STATUS_PUBLICO_PROC[paraStatus] ?? paraStatus;
}

export function normalizarNumeroProcesso(v: string | null | undefined): string {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export type ProcessoPublico = {
  numero: string;
  status: string;
  status_detalhe: string;
  municipio: string;
  orgao: string;
  tipo_ato: string;
  data_protocolo: Date | null;
  data_conclusao: Date | null;
  requerente: { nome: string; documento: string };
  empreendimento: string;
  titularidade_confirmada: boolean;
  linha_do_tempo: { data: Date; etapa: string; situacao: string }[];
  documentos: { tipo_rotulo: string; titulo: string; numero: string; emitido_em: Date; validade_ate: Date | null; status: StatusPublico; codigo_verificador: string }[];
};

/**
 * Consulta pública: exige o número EXATO do processo (sem busca parcial → evita varredura).
 * `doc` (CPF/CNPJ) opcional: se informado precisa conferir com o requerente (dupla chave).
 */
export async function consultarProcessoPublico(numeroBruto: string, docBruto?: string | null): Promise<ProcessoPublico | null> {
  const numero = normalizarNumeroProcesso(numeroBruto);
  if (!/^[A-Z]{2,5}-\d{4}-\d{1,8}$/.test(numero)) return null;
  const p = await prisma.processo.findUnique({
    where: { numero },
    include: {
      municipio: { select: { nome: true, orgao_ambiental_nome: true } },
      tipo_ato: { select: { nome: true, sigla: true } },
      requerente: { select: { tipo: true, nome: true, cpf_cnpj_mascara: true, cpf_cnpj_hash: true } },
      empreendimento: { select: { nome: true } },
      tramitacoes: { where: { publico: true }, orderBy: { created_at: "asc" }, select: { acao: true, para_status: true, created_at: true } },
      documentos: {
        where: { tipo: { in: [...TIPOS_PUBLICOS] } },
        orderBy: { emitido_em: "asc" },
        select: { tipo: true, numero: true, emitido_em: true, validade_ate: true, status: true, codigo_verificador: true, dados: true },
      },
    },
  });
  if (!p || p.status === "RASCUNHO") return null;
  const doc = somenteDigitos(docBruto ?? "");
  let confirmada = false;
  if (doc) {
    if (hashBusca(doc) !== p.requerente.cpf_cnpj_hash) return null;
    confirmada = true;
  }
  const tit = titularPublico(p.requerente)!;
  return {
    numero: p.numero!,
    status: p.status,
    status_detalhe: ROTULO_STATUS_PUBLICO_PROC[p.status] ?? p.status,
    municipio: p.municipio.nome,
    orgao: p.municipio.orgao_ambiental_nome,
    tipo_ato: `${p.tipo_ato.nome} (${p.tipo_ato.sigla})`,
    data_protocolo: p.data_protocolo,
    data_conclusao: p.data_conclusao,
    requerente: tit,
    empreendimento: p.empreendimento.nome,
    titularidade_confirmada: confirmada,
    linha_do_tempo: p.tramitacoes.map((t) => ({ data: t.created_at, etapa: rotuloEtapaPublica(t.acao, t.para_status), situacao: ROTULO_STATUS_PUBLICO_PROC[t.para_status] ?? t.para_status })),
    documentos: p.documentos.map((d) => ({
      tipo_rotulo: ROTULO_TIPO_DOCUMENTO[d.tipo] ?? d.tipo,
      titulo: (((d.dados as Record<string, unknown> | null)?._contexto as Ctx | undefined)?.titulo) ?? ROTULO_TIPO_DOCUMENTO[d.tipo],
      numero: d.numero,
      emitido_em: d.emitido_em,
      validade_ate: d.validade_ate,
      status: statusPublico(d),
      codigo_verificador: d.codigo_verificador,
    })),
  };
}

// ───────────── /licencas (transparência) ─────────────

export type FiltroLicencas = { municipio?: string | null; tipo?: string | null; sigla?: string | null; de?: string | null; ate?: string | null; skip: number; take: number };

function dataValida(v: string | null | undefined, fimDoDia = false): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T${fimDoDia ? "23:59:59.999" : "00:00:00"}-03:00`);
  return isNaN(d.getTime()) ? null : d;
}

export async function listarLicencasPublicas(f: FiltroLicencas) {
  const tipos = f.tipo && (TIPOS_PUBLICOS as readonly string[]).includes(f.tipo) ? [f.tipo as TipoDocumento] : [...TIPOS_PUBLICOS];
  const de = dataValida(f.de);
  const ate = dataValida(f.ate, true);
  const where: Prisma.DocumentoOficialWhereInput = {
    tipo: { in: tipos },
    ...(f.municipio ? { municipio: { sigla: f.municipio.toUpperCase() } } : {}),
    ...(f.sigla ? { sigla_ato: f.sigla.toUpperCase() } : {}),
    ...(de || ate ? { emitido_em: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } } : {}),
  };
  const [total, docs] = await Promise.all([
    prisma.documentoOficial.count({ where }),
    prisma.documentoOficial.findMany({
      where,
      orderBy: { emitido_em: "desc" },
      skip: f.skip,
      take: f.take,
      include: { municipio: { select: { nome: true, sigla: true } }, processo: { select: { numero: true, empreendimento: { select: { nome: true } } } } },
    }),
  ]);
  const titulares = await prisma.pessoa.findMany({
    where: { id: { in: docs.map((d) => d.titular_id).filter((x): x is string => !!x) } },
    select: { id: true, tipo: true, nome: true, cpf_cnpj_mascara: true },
  });
  const mapa = new Map(titulares.map((t) => [t.id, t]));
  return {
    total,
    itens: docs.map((d) => {
      const ctx = ((d.dados as Record<string, unknown> | null)?._contexto ?? {}) as Ctx;
      return {
        tipo: d.tipo,
        tipo_rotulo: ROTULO_TIPO_DOCUMENTO[d.tipo],
        titulo: ctx.titulo ?? ROTULO_TIPO_DOCUMENTO[d.tipo],
        sigla_ato: d.sigla_ato,
        numero: d.numero,
        titular: titularPublico(d.titular_id ? mapa.get(d.titular_id) : null),
        empreendimento: d.processo?.empreendimento?.nome ?? ctx.empreendimento?.nome ?? null,
        processo_numero: d.processo?.numero ?? null,
        municipio: d.municipio.nome,
        municipio_sigla: d.municipio.sigla,
        emitido_em: d.emitido_em,
        validade_ate: d.validade_ate,
        status: statusPublico(d),
        codigo_verificador: d.codigo_verificador,
      };
    }),
  };
}

export async function opcoesFiltroPublico() {
  const [municipios, siglas] = await Promise.all([
    prisma.municipio.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { sigla: true, nome: true } }),
    prisma.tipoAto.findMany({ where: { ativo: true, categoria: { in: ["LICENCA", "AUTORIZACAO", "CERTIDAO"] } }, orderBy: { sigla: "asc" }, distinct: ["sigla"], select: { sigla: true, nome: true } }),
  ]);
  // Portal público lista órgãos de todas as organizações; siglas repetidas entre clientes aparecem uma vez só.
  return { municipios, siglas };
}

/** Números de transparência do portal do órgão (contagens simples, indexadas por municipio_id). */
export async function numerosTransparencia(municipioId: string) {
  const [licencas, vigentes, andamento, denuncias] = await Promise.all([
    prisma.documentoOficial.count({ where: { municipio_id: municipioId, tipo: { in: [...TIPOS_PUBLICOS] } } }),
    prisma.documentoOficial.count({ where: { municipio_id: municipioId, tipo: { in: [...TIPOS_PUBLICOS] }, status: "VALIDO", OR: [{ validade_ate: null }, { validade_ate: { gte: new Date() } }] } }),
    prisma.processo.count({ where: { municipio_id: municipioId, status: { in: ["PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO", "DEFERIDO"] } } }),
    prisma.denuncia.count({ where: { municipio_id: municipioId } }),
  ]);
  return { licencas, vigentes, andamento, denuncias };
}
