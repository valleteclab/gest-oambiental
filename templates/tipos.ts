// Contexto de renderização dos modelos de documento oficial (SPEC 7). Montado por lib/documentos/contexto.ts.
export type TipoDoc = "LICENCA" | "AUTORIZACAO" | "CERTIDAO" | "AUTO_INFRACAO" | "NOTIFICACAO" | "PARECER" | "OFICIO" | "RECIBO";

export type ContextoDocumento = {
  tipo: TipoDoc;
  titulo: string;
  numero: string;
  codigo: string;
  url_validacao: string;
  dominio: string;
  emitido_em: Date;
  signatario: { nome: string; cargo: string | null };
  municipio: { nome: string; sigla: string; orgao: string; endereco: string | null; email: string | null; telefone: string | null; brasao: string; organizacao: string | null; /** logo horizontal da organização (data URI), quando houver */ logo?: string | null };
  titular: { nome: string; tipo: "PF" | "PJ"; documento: string; endereco: string } | null;
  processo: { numero: string | null; data_protocolo: Date | null; tipo_ato_nome: string | null; tipo_ato_sigla: string | null; descricao_atividade: string | null } | null;
  empreendimento: {
    nome: string;
    endereco: string;
    latitude: string | null;
    longitude: string | null;
    tipologia: string | null;
    porte: string | null;
    potencial_poluidor: string | null;
    area_m2: string | null;
    numero_car: string | null;
  } | null;
  rt: { nome: string; registro: string } | null;
  validade_ate: Date | null;
  condicionantes: { descricao: string; periodicidade?: string | null; prazo_ate?: Date | string | null }[];
  parecer: { numero: string; conclusao: string; texto_html: string; autor: string | null } | null;
  auto: {
    numero: string;
    enquadramento_legal: string;
    descricao_infracao: string;
    penalidade: string;
    valor_multa: string | null;
    prazo_defesa_dias: number;
  } | null;
  notificacao: { numero: string; exigencia: string; prazo_dias: number; prazo_ate: Date | null } | null;
  fiscalizacao: { data_hora: Date; latitude: string | null; longitude: string | null; relato: string | null; constatacao: string | null } | null;
  anexos: { nome: string; tipo: string; sha256: string }[];
  /** Dados livres enviados pelo módulo de origem (texto, motivo, observacoes, fundamentacao…) */
  dados: Record<string, unknown>;
};
