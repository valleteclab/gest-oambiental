// Integração SEIA (SEMA/INEMA) – SPEC §2 (P2) e §12: feed somente leitura de processos para o sistema estadual.
// Mapeamento PURO (testado em tests/unit/seia.test.ts). O formato é provisório até a definição com a SEMA/INEMA.
// Nunca expõe texto interno (despachos, pareceres, observações) nem o CPF/CNPJ completo.
import { mascararCpfCnpj } from "../crypto";

export const FORMATO_SEIA = "LicenciaGov-SEIA v0 (provisório – a confirmar com SEMA/INEMA)";

/** Tipos de documento oficial enviados no feed (pareceres, ofícios e recibos são internos/administrativos). */
export const TIPOS_DOCUMENTO_SEIA = ["LICENCA", "AUTORIZACAO", "CERTIDAO", "NOTIFICACAO", "AUTO_INFRACAO"] as const;

type Decimalish = { toNumber(): number } | number | string | null | undefined;

export type ProcessoSeiaFonte = {
  numero: string | null;
  status: string;
  data_protocolo: Date | null;
  data_conclusao: Date | null;
  created_at: Date;
  updated_at: Date;
  municipio: { codigo_ibge: string; nome: string; sigla: string };
  tipo_ato: { sigla: string; nome: string; categoria?: string | null };
  empreendimento: {
    nome: string;
    latitude: Decimalish;
    longitude: Decimalish;
    numero_car: string | null;
    porte: string;
    potencial_poluidor: string;
    tipologia: { codigo: string; descricao: string; divisao?: string | null } | null;
  };
  requerente: { nome: string; tipo: "PF" | "PJ"; /** CPF/CNPJ decifrado (só para mascarar) */ documento: string | null; cpf_cnpj_mascara: string };
  documentos: {
    tipo: string;
    numero: string;
    sigla_ato: string | null;
    emitido_em: Date;
    validade_ate: Date | null;
    status: string;
    codigo_verificador: string;
    sha256_pdf: string;
    updated_at?: Date;
  }[];
};

export type ProcessoSeia = ReturnType<typeof paraSeia>;

const numero = (v: Decimalish): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "object" ? v.toNumber() : Number(v);
  return Number.isFinite(n) ? n : null;
};
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Documento do requerente SEMPRE mascarado (PF e PJ) – mesma máscara do portal público. */
export function documentoMascarado(documento: string | null, mascaraSalva: string): string {
  if (documento && /\d/.test(documento)) return mascararCpfCnpj(documento);
  return mascaraSalva || "***";
}

/** Converte o processo (com relações) no item do feed SEIA. `urlValidacao` monta o link público do documento. */
export function paraSeia(p: ProcessoSeiaFonte, urlValidacao: (codigo: string) => string) {
  const e = p.empreendimento;
  return {
    numero: p.numero,
    status: p.status,
    municipio: { codigo_ibge: p.municipio.codigo_ibge, nome: p.municipio.nome, sigla: p.municipio.sigla },
    tipo_ato: { sigla: p.tipo_ato.sigla, nome: p.tipo_ato.nome },
    tipologia: e.tipologia ? { codigo: e.tipologia.codigo, nome: e.tipologia.descricao } : null,
    porte: e.porte,
    potencial_poluidor: e.potencial_poluidor,
    datas: { protocolo: iso(p.data_protocolo), conclusao: iso(p.data_conclusao), atualizado_em: iso(p.updated_at) },
    empreendimento: {
      nome: e.nome,
      latitude: numero(e.latitude),
      longitude: numero(e.longitude),
      numero_car: e.numero_car || null,
    },
    requerente: {
      nome: p.requerente.nome,
      tipo: p.requerente.tipo,
      documento: documentoMascarado(p.requerente.documento, p.requerente.cpf_cnpj_mascara),
    },
    documentos: p.documentos
      .filter((d) => (TIPOS_DOCUMENTO_SEIA as readonly string[]).includes(d.tipo))
      .map((d) => ({
        tipo: d.tipo,
        numero: d.numero,
        sigla_ato: d.sigla_ato,
        emitido_em: iso(d.emitido_em),
        validade_ate: iso(d.validade_ate),
        status: d.status,
        url_validacao: urlValidacao(d.codigo_verificador),
        sha256: d.sha256_pdf,
      })),
  };
}
