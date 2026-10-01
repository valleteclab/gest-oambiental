import "server-only";
import type { Prisma, TipoDocumento } from "@prisma/client";
import { prisma } from "../db";
import { decifrar, formatarCpfCnpj } from "../crypto";
import { fmtNumero } from "../format";
import { imagemDataUri, logoProprio } from "../imagem";
import { BRASAO_GENERICO_URI, TITULO_PADRAO, type ContextoDocumento } from "@/templates";
import { formatarEndereco, TIPOS_PUBLICOS } from "./render";
import type { EmitirInput } from "./index";

// Carrega do banco tudo o que os modelos precisam (município, titular, processo, empreendimento, parecer, auto…).
type Cliente = Prisma.TransactionClient | typeof prisma;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const dec = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString());

const ROTULO_PORTE: Record<string, string> = { MICRO: "Micro", PEQUENO: "Pequeno", MEDIO: "Médio", GRANDE: "Grande", EXCEPCIONAL: "Excepcional" };
const ROTULO_POTENCIAL: Record<string, string> = { BAIXO: "Baixo", MEDIO: "Médio", ALTO: "Alto" };

/** Brasão como data URI (o Chromium não acessa URLs relativas do app). */
export async function resolverBrasao(url: string | null | undefined): Promise<string> {
  return (await imagemDataUri(url)) ?? BRASAO_GENERICO_URI;
}

type Condicionante = ContextoDocumento["condicionantes"][number];

function condicionantesDeDados(v: unknown): Condicionante[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .map((c): Condicionante | null => {
      if (typeof c === "string") return c.trim() ? { descricao: c.trim() } : null;
      if (c && typeof c === "object" && "descricao" in c) {
        const o = c as Record<string, unknown>;
        return { descricao: String(o.descricao), periodicidade: o.periodicidade ? String(o.periodicidade) : null, prazo_ate: (o.prazo_ate as string) ?? null };
      }
      return null;
    })
    .filter((c): c is Condicionante => !!c);
}

export type ContextoBase = Omit<ContextoDocumento, "numero" | "codigo" | "url_validacao" | "dominio" | "emitido_em"> & {
  sigla_municipio: string;
  sigla_ato: string | null;
  titular_id: string | null;
  fiscalizacao_id: string | null;
  validade_meses_padrao: number | null;
  titular_mascara: string | null;
};

export async function carregarContexto(input: EmitirInput, db: Cliente = prisma): Promise<ContextoBase> {
  const d = input.dados ?? {};
  const municipio = await db.municipio.findUnique({ where: { id: input.municipio_id }, include: { organizacao: true } });
  if (!municipio) throw new Error(`Município ${input.municipio_id} não encontrado`);

  const processo = input.processo_id
    ? await db.processo.findUnique({
        where: { id: input.processo_id },
        include: {
          tipo_ato: true,
          empreendimento: { include: { tipologia: true } },
          rt: { include: { pessoa: true } },
          condicionantes: { where: { status: { not: "CANCELADA" } }, orderBy: { created_at: "asc" } },
          anexos: { orderBy: { created_at: "asc" } },
        },
      })
    : null;
  if (input.processo_id && !processo) throw new Error(`Processo ${input.processo_id} não encontrado`);
  if (processo && processo.municipio_id !== input.municipio_id) throw new Error("Processo não pertence ao município informado");

  const auto = ehUuid(d.auto_infracao_id) ? await db.autoInfracao.findUnique({ where: { id: d.auto_infracao_id } }) : null;
  const notificacao = ehUuid(d.notificacao_id) ? await db.notificacao.findUnique({ where: { id: d.notificacao_id } }) : null;
  const fiscalizacaoId = input.fiscalizacao_id ?? auto?.fiscalizacao_id ?? notificacao?.fiscalizacao_id ?? null;
  const fiscalizacao = fiscalizacaoId ? await db.fiscalizacao.findUnique({ where: { id: fiscalizacaoId }, include: { empreendimento: { include: { tipologia: true } } } }) : null;

  let parecer = null as null | { numero: string; conclusao: string; texto_html: string; autor: string | null };
  if (input.tipo === "PARECER") {
    const p = ehUuid(d.parecer_id)
      ? await db.parecer.findUnique({ where: { id: d.parecer_id } })
      : processo
        ? await db.parecer.findFirst({ where: { processo_id: processo.id }, orderBy: { created_at: "desc" } })
        : null;
    if (p) {
      const autor = await db.usuario.findUnique({ where: { id: p.autor_id }, select: { nome: true, cargo: true } });
      parecer = { numero: p.numero, conclusao: p.conclusao, texto_html: p.texto_html, autor: autor ? [autor.nome, autor.cargo].filter(Boolean).join(", ") : null };
    }
  }

  const empId = ehUuid(d.empreendimento_id) ? d.empreendimento_id : null;
  const emp = processo?.empreendimento ?? fiscalizacao?.empreendimento ?? (empId ? await db.empreendimento.findUnique({ where: { id: empId }, include: { tipologia: true } }) : null);

  const titularId = input.titular_id ?? processo?.requerente_id ?? auto?.autuado_id ?? notificacao?.notificado_id ?? emp?.requerente_id ?? null;
  const pessoa = titularId ? await db.pessoa.findUnique({ where: { id: titularId } }) : null;

  // Documento do titular: em documentos de interesse público, CPF de PF sai mascarado (LGPD); demais, completo.
  let docTitular = pessoa?.cpf_cnpj_mascara ?? "";
  if (pessoa && !(pessoa.tipo === "PF" && (TIPOS_PUBLICOS as readonly string[]).includes(input.tipo))) {
    try {
      docTitular = formatarCpfCnpj(decifrar(pessoa.cpf_cnpj_cifrado) ?? "") || docTitular;
    } catch {
      /* mantém máscara */
    }
  }

  const siglaAto = input.sigla_ato ?? processo?.tipo_ato.sigla ?? null;
  const tipoAto =
    processo && (!input.sigla_ato || input.sigla_ato === processo.tipo_ato.sigla)
      ? processo.tipo_ato
      : input.sigla_ato
        ? await db.tipoAto.findUnique({ where: { organizacao_id_sigla: { organizacao_id: municipio.organizacao_id, sigla: input.sigla_ato } } })
        : null;

  const condicionantes =
    condicionantesDeDados(d.condicionantes) ??
    (["LICENCA", "AUTORIZACAO", "PARECER"].includes(input.tipo) && processo
      ? processo.condicionantes.map((c) => ({ descricao: c.descricao, periodicidade: c.periodicidade, prazo_ate: c.prazo_ate }))
      : []);

  const tipo = input.tipo as TipoDocumento;
  const tituloPadrao = (tipo === "LICENCA" || tipo === "AUTORIZACAO") && tipoAto ? tipoAto.nome : TITULO_PADRAO[tipo];

  const rtPessoa = processo?.rt?.pessoa;
  return {
    tipo,
    titulo: typeof d.titulo === "string" && d.titulo.trim() ? d.titulo.trim() : tituloPadrao,
    signatario: { nome: input.usuario.nome, cargo: tipo === "RECIBO" ? "Protocolo eletrônico" : input.usuario.cargo },
    municipio: {
      nome: municipio.nome,
      sigla: municipio.sigla,
      orgao: municipio.orgao_ambiental_nome,
      endereco: municipio.endereco,
      email: municipio.email,
      telefone: municipio.telefone,
      brasao: await resolverBrasao(municipio.brasao_url),
      // Logo horizontal da organização (cliente), quando houver: substitui o brasão no cabeçalho do PDF.
      logo: await imagemDataUri(logoProprio(municipio.organizacao?.logo_url)),
      organizacao: municipio.organizacao?.nome ?? null,
    },
    titular: pessoa ? { nome: pessoa.nome, tipo: pessoa.tipo, documento: docTitular, endereco: formatarEndereco(pessoa.endereco) } : null,
    processo: processo
      ? {
          numero: processo.numero,
          data_protocolo: processo.data_protocolo,
          tipo_ato_nome: tipoAto?.nome ?? processo.tipo_ato.nome,
          tipo_ato_sigla: tipoAto?.sigla ?? processo.tipo_ato.sigla,
          descricao_atividade: processo.descricao_atividade,
        }
      : null,
    empreendimento: emp
      ? {
          nome: emp.nome,
          endereco: formatarEndereco(emp.endereco),
          latitude: dec(emp.latitude),
          longitude: dec(emp.longitude),
          tipologia: emp.tipologia ? `${emp.tipologia.codigo} – ${emp.tipologia.descricao}` : null,
          porte: ROTULO_PORTE[emp.porte] ?? emp.porte,
          potencial_poluidor: ROTULO_POTENCIAL[emp.potencial_poluidor] ?? emp.potencial_poluidor,
          area_m2: emp.area_m2 ? fmtNumero(emp.area_m2, 2) : null,
          numero_car: emp.numero_car,
        }
      : null,
    rt: rtPessoa && processo?.rt ? { nome: rtPessoa.nome, registro: `${processo.rt.conselho}/${processo.rt.uf_conselho} ${processo.rt.registro_conselho}` } : null,
    validade_ate: input.validade_ate ?? null,
    condicionantes,
    parecer,
    auto: auto
      ? {
          numero: auto.numero,
          enquadramento_legal: auto.enquadramento_legal,
          descricao_infracao: auto.descricao_infracao,
          penalidade: auto.penalidade,
          valor_multa: dec(auto.valor_multa),
          prazo_defesa_dias: auto.prazo_defesa_dias,
        }
      : null,
    notificacao: notificacao ? { numero: notificacao.numero, exigencia: notificacao.exigencia, prazo_dias: notificacao.prazo_dias, prazo_ate: notificacao.prazo_ate } : null,
    fiscalizacao: fiscalizacao
      ? { data_hora: fiscalizacao.data_hora, latitude: dec(fiscalizacao.latitude), longitude: dec(fiscalizacao.longitude), relato: fiscalizacao.relato, constatacao: fiscalizacao.constatacao }
      : null,
    modelo_ato: tipoAto?.modelo_documento ?? null,
    anexos: tipo === "RECIBO" && processo ? processo.anexos.map((a) => ({ nome: a.nome_arquivo, tipo: a.tipo, sha256: a.sha256 })) : [],
    dados: d,
    sigla_municipio: municipio.sigla,
    sigla_ato: siglaAto,
    titular_id: pessoa?.id ?? null,
    fiscalizacao_id: fiscalizacao?.id ?? null,
    validade_meses_padrao: tipoAto?.validade_meses_padrao ?? null,
    titular_mascara: pessoa?.cpf_cnpj_mascara ?? null,
  };
}
