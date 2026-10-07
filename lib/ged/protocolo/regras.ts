// Regras PURAS do protocolo do GED (sem banco/rede): numeração, situações e transições, validação das entradas, códigos de
// consulta/verificação, permissões e textos públicos. Testadas em tests/unit/ged-protocolo.test.ts.
//
// Livros: ENTRADA (recebido de pessoa/órgão externo), SAIDA (enviado ao externo) e INTERNO (entre setores/pessoas do órgão).
// Numeração anual sequencial por cliente e por livro:  PROT-ENT-2026-000123 · PROT-SAI-2026-000045 · PROT-INT-2026-000007.
import type { GedLivroProtocolo, GedPapel, GedSituacaoProtocolo, GedTipoEventoProtocolo, Prisma } from "@prisma/client";
import { z } from "zod";
import { gerarCodigoVerificador, somenteDigitos, validarCpfCnpj } from "@/lib/crypto";
import { TETO_ACOES } from "../papeis";

// ───────────── Livros e numeração ─────────────

export { LIVROS, PRIORIDADES, ROTULO_LIVRO, ROTULO_PRIORIDADE } from "./rotulos";
export const SIGLA_LIVRO: Record<GedLivroProtocolo, string> = { ENTRADA: "ENT", SAIDA: "SAI", INTERNO: "INT" };
const LIVRO_DA_SIGLA: Record<string, GedLivroProtocolo> = { ENT: "ENTRADA", SAI: "SAIDA", INT: "INTERNO" };

/** Tipo da sequência em GedSequencia (um contador por cliente, livro e ano). */
export const tipoSequenciaProtocolo = (livro: GedLivroProtocolo) => `PROT_${SIGLA_LIVRO[livro]}`;

export function formatarNumeroProtocolo(livro: GedLivroProtocolo, ano: number, sequencia: number): string {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2999) throw new Error("Protocolo: ano inválido.");
  if (!Number.isInteger(sequencia) || sequencia < 1) throw new Error("Protocolo: sequência inválida.");
  return `PROT-${SIGLA_LIVRO[livro]}-${ano}-${String(sequencia).padStart(6, "0")}`;
}

const RE_NUMERO = /^PROT-(ENT|SAI|INT)-(\d{4})-(\d{6,})$/;
/** Lê um número de protocolo (aceita minúsculas e espaços). null se não for um número válido. */
export function lerNumeroProtocolo(v: string | null | undefined): { livro: GedLivroProtocolo; ano: number; sequencia: number; numero: string } | null {
  const t = (v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const m = RE_NUMERO.exec(t);
  if (!m) return null;
  return { livro: LIVRO_DA_SIGLA[m[1]], ano: Number(m[2]), sequencia: Number(m[3]), numero: t };
}

// ───────────── Códigos de consulta e de verificação ─────────────

const RE_CODIGO = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

/** Aceita o código com ou sem hífens/espaços e em minúsculas; null se não tiver o formato XXXX-XXXX-XXXX. */
export function normalizarCodigoProtocolo(v: string | null | undefined): string | null {
  const t = (v ?? "").toUpperCase().replace(/[\s-]+/g, "");
  if (t.length !== 12) return null;
  const c = `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8, 12)}`;
  return RE_CODIGO.test(c) ? c : null;
}

/** Dois códigos aleatórios DIFERENTES (consulta do cidadão × verificação do comprovante). 60 bits cada. */
export function gerarCodigosProtocolo(gerar: () => string = gerarCodigoVerificador): { codigo_consulta: string; codigo_verificacao: string } {
  const codigo_consulta = gerar();
  let codigo_verificacao = gerar();
  while (codigo_verificacao === codigo_consulta) codigo_verificacao = gerar();
  return { codigo_consulta, codigo_verificacao };
}

// ───────────── Situações e transições ─────────────

export const SITUACOES: readonly GedSituacaoProtocolo[] = ["RECEBIDO", "EM_ANALISE", "ENCAMINHADO", "RESPONDIDO", "ARQUIVADO", "INDEFERIDO", "DEVOLVIDO"];
export const ROTULO_SITUACAO: Record<GedSituacaoProtocolo, string> = {
  RECEBIDO: "Recebido",
  EM_ANALISE: "Em análise",
  ENCAMINHADO: "Encaminhado",
  RESPONDIDO: "Respondido",
  ARQUIVADO: "Arquivado",
  INDEFERIDO: "Indeferido",
  DEVOLVIDO: "Devolvido",
};
export const COR_SITUACAO: Record<GedSituacaoProtocolo, "verde" | "amarelo" | "vermelho" | "azul" | "cinza" | "roxo"> = {
  RECEBIDO: "azul",
  EM_ANALISE: "amarelo",
  ENCAMINHADO: "roxo",
  RESPONDIDO: "verde",
  ARQUIVADO: "cinza",
  INDEFERIDO: "vermelho",
  DEVOLVIDO: "vermelho",
};
/** Rótulo da situação no contexto do livro (saída e interno não são "recebidos": são "registrados"). */
export const rotuloSituacao = (s: GedSituacaoProtocolo, livro: GedLivroProtocolo) => (s === "RECEBIDO" && livro !== "ENTRADA" ? "Registrado" : ROTULO_SITUACAO[s]);


export type AcaoProtocolo = "ANALISAR" | "ENCAMINHAR" | "RESPONDER" | "ARQUIVAR" | "DEVOLVER" | "INDEFERIR";
export const ACOES_PROTOCOLO: readonly AcaoProtocolo[] = ["ANALISAR", "ENCAMINHAR", "RESPONDER", "ARQUIVAR", "DEVOLVER", "INDEFERIR"];
export const ROTULO_ACAO_PROTOCOLO: Record<AcaoProtocolo, string> = {
  ANALISAR: "Iniciar análise", ENCAMINHAR: "Encaminhar", RESPONDER: "Responder", ARQUIVAR: "Arquivar", DEVOLVER: "Devolver", INDEFERIR: "Indeferir",
};

/** Situação resultante de cada ação (a máquina de situações: o que cada ação pode partir de cada situação). */
export const SITUACAO_APOS: Record<AcaoProtocolo, GedSituacaoProtocolo> = {
  ANALISAR: "EM_ANALISE", ENCAMINHAR: "ENCAMINHADO", RESPONDER: "RESPONDIDO", ARQUIVAR: "ARQUIVADO", DEVOLVER: "DEVOLVIDO", INDEFERIR: "INDEFERIDO",
};
export const TIPO_EVENTO_DA_ACAO: Record<AcaoProtocolo, GedTipoEventoProtocolo> = {
  ANALISAR: "ANALISE", ENCAMINHAR: "ENCAMINHAMENTO", RESPONDER: "RESPOSTA", ARQUIVAR: "ARQUIVAMENTO", DEVOLVER: "DEVOLUCAO", INDEFERIR: "INDEFERIMENTO",
};

const DECISORIAS: AcaoProtocolo[] = ["RESPONDER", "ARQUIVAR", "DEVOLVER", "INDEFERIR"];
/** Ações permitidas a partir de cada situação. Arquivado é terminal; respondido/devolvido/indeferido só admitem arquivar. */
export const ACOES_POR_SITUACAO: Record<GedSituacaoProtocolo, readonly AcaoProtocolo[]> = {
  RECEBIDO: ["ANALISAR", "ENCAMINHAR", ...DECISORIAS],
  EM_ANALISE: ["ENCAMINHAR", ...DECISORIAS],
  ENCAMINHADO: ["ANALISAR", "ENCAMINHAR", ...DECISORIAS],
  RESPONDIDO: ["ARQUIVAR"],
  INDEFERIDO: ["ARQUIVAR"],
  DEVOLVIDO: ["ARQUIVAR"],
  ARQUIVADO: [],
};
export const acoesPermitidas = (s: GedSituacaoProtocolo): readonly AcaoProtocolo[] => ACOES_POR_SITUACAO[s];
export const podeAplicarAcao = (s: GedSituacaoProtocolo, a: AcaoProtocolo) => ACOES_POR_SITUACAO[s].includes(a);
/** Próxima situação, ou null se a ação não é permitida na situação atual. */
export const proximaSituacao = (s: GedSituacaoProtocolo, a: AcaoProtocolo): GedSituacaoProtocolo | null => (podeAplicarAcao(s, a) ? SITUACAO_APOS[a] : null);
/** Situação que encerra o protocolo (grava `concluido_em`). */
export const situacaoConclui = (s: GedSituacaoProtocolo) => s === "RESPONDIDO" || s === "ARQUIVADO" || s === "INDEFERIDO" || s === "DEVOLVIDO";

/** Mínimos de texto: responder/devolver/indeferir são vistos pelo interessado e exigem texto. */
export const MIN_TEXTO_ACAO: Partial<Record<AcaoProtocolo, number>> = { RESPONDER: 5, DEVOLVER: 10, INDEFERIR: 10 };
/** Ações cujo texto é exibido ao interessado na consulta pública. */
export const ACOES_COM_TEXTO_PUBLICO: readonly AcaoProtocolo[] = ["RESPONDER", "DEVOLVER", "INDEFERIR"];

export const zAcaoProtocolo = z.object({
  acao: z.enum(["ANALISAR", "ENCAMINHAR", "RESPONDER", "ARQUIVAR", "DEVOLVER", "INDEFERIR"]),
  texto: z.string().trim().max(4000, "Texto com até 4000 caracteres.").optional(),
  destino_setor_id: z.string().uuid().optional(),
  destino_usuario_id: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  const min = MIN_TEXTO_ACAO[v.acao];
  if (min && (v.texto ?? "").length < min) {
    ctx.addIssue({ code: "custom", path: ["texto"], message: v.acao === "RESPONDER" ? `Escreva a resposta (mínimo de ${min} caracteres).` : `Informe a justificativa (mínimo de ${min} caracteres).` });
  }
  if (v.acao === "ENCAMINHAR") {
    if (!v.destino_setor_id && !v.destino_usuario_id) ctx.addIssue({ code: "custom", path: ["destino_setor_id"], message: "Escolha o setor ou a pessoa de destino." });
    if (v.destino_setor_id && v.destino_usuario_id) ctx.addIssue({ code: "custom", path: ["destino_setor_id"], message: "Escolha apenas um destino: setor OU pessoa." });
  }
});
export type EntradaAcaoProtocolo = z.infer<typeof zAcaoProtocolo>;

// ───────────── Entradas ─────────────

const vazio = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const texto = (max: number, rotulo: string) => z.string().trim().max(max, `${rotulo} com até ${max} caracteres.`);

/** Telefone com 10 a 13 dígitos (DDD, ou DDI+DDD). */
export const telefoneValido = (v: string) => { const n = somenteDigitos(v).length; return n >= 10 && n <= 13; };

export const zInteressadoExterno = z.object({
  nome: texto(200, "Nome").min(3, "Informe o nome completo."),
  cpf_cnpj: z.preprocess(vazio, z.string().refine(validarCpfCnpj, "CPF ou CNPJ inválido.").optional()),
  email: z.preprocess(vazio, z.string().trim().max(200).email("E-mail inválido.").optional()),
  telefone: z.preprocess(vazio, z.string().trim().max(30).refine(telefoneValido, "Telefone inválido (informe o DDD).").optional()),
});
export type InteressadoExterno = z.infer<typeof zInteressadoExterno>;

const dataFutura = z.preprocess(vazio, z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Data do prazo inválida.").optional());
const uuidOpc = z.preprocess(vazio, z.string().uuid("Identificador inválido.").optional());

const base = {
  assunto: texto(200, "Assunto").min(3, "Informe o assunto (mínimo de 3 caracteres)."),
  descricao: z.preprocess(vazio, texto(5000, "Descrição").optional()),
  tipo_documento_id: uuidOpc,
  prioridade: z.preprocess(vazio, z.enum(["BAIXA", "NORMAL", "ALTA", "URGENTE"]).default("NORMAL")),
  prazo_resposta: dataFutura,
};

/** Registro feito por servidor (balcão, saída ou interno). Cada livro exige campos diferentes. */
export const zRegistroServidor = z.discriminatedUnion("livro", [
  z.object({ livro: z.literal("ENTRADA"), ...base, interessado: zInteressadoExterno, destino_setor_id: uuidOpc, destino_usuario_id: uuidOpc }),
  z.object({ livro: z.literal("SAIDA"), ...base, interessado: zInteressadoExterno, origem_setor_id: z.string().uuid("Escolha o setor de origem.") }),
  z.object({ livro: z.literal("INTERNO"), ...base, origem_setor_id: z.string().uuid("Escolha o setor de origem."), destino_setor_id: uuidOpc, destino_usuario_id: uuidOpc }),
]).superRefine((v, ctx) => {
  if (v.livro === "SAIDA") return;
  if (!v.destino_setor_id && !v.destino_usuario_id) ctx.addIssue({ code: "custom", path: ["destino_setor_id"], message: "Escolha o setor ou a pessoa de destino." });
  if (v.destino_setor_id && v.destino_usuario_id) ctx.addIssue({ code: "custom", path: ["destino_setor_id"], message: "Escolha apenas um destino: setor OU pessoa." });
});
export type RegistroServidor = z.infer<typeof zRegistroServidor>;

/** Envio pelo portal público. `website` é o campo-isca (honeypot): preenchido = robô. */
export const zEnvioPortal = z.object({
  nome: texto(200, "Nome").min(3, "Informe o seu nome completo."),
  cpf_cnpj: z.string().refine(validarCpfCnpj, "CPF ou CNPJ inválido."),
  email: z.string().trim().max(200).email("Informe um e-mail válido."),
  telefone: z.preprocess(vazio, z.string().trim().max(30).refine(telefoneValido, "Telefone inválido (informe o DDD).").optional()),
  assunto_id: z.string().uuid("Escolha o assunto."),
  descricao: texto(5000, "Descrição").min(10, "Descreva o que você está enviando (mínimo de 10 caracteres)."),
  aceite_lgpd: z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.literal(true, { error: "É preciso aceitar o tratamento dos dados pessoais para protocolar." })),
  website: z.preprocess(vazio, z.string().max(200).optional()),
});
export type EnvioPortal = z.infer<typeof zEnvioPortal>;

export const zConsultaPublica = z.object({
  numero: z.string().trim().max(40).transform((s) => lerNumeroProtocolo(s)?.numero ?? null),
  codigo: z.string().trim().max(40).transform((s) => normalizarCodigoProtocolo(s)),
});

/** Slug público do portal: minúsculas, números e hífen (3 a 60), sem hífen nas pontas. */
export const RE_SLUG_PUBLICO = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
export const SLUGS_RESERVADOS: readonly string[] = ["admin", "api", "ged", "login", "sair", "verificar", "protocolo", "consulta", "static", "public", "www", "app"];
export function normalizarSlug(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
export function erroSlug(slug: string): string | null {
  if (!RE_SLUG_PUBLICO.test(slug)) return "Endereço público: 3 a 60 caracteres, só letras minúsculas, números e hífen.";
  if (SLUGS_RESERVADOS.includes(slug)) return "Este endereço é reservado. Escolha outro.";
  return null;
}

// ───────────── Anexos ─────────────

export const LIMITE_MAX_ANEXOS = 10;
export const LIMITE_MAX_MB = 25;
/** Limites efetivos do portal a partir da configuração (nunca acima do teto do sistema). */
export function limitesAnexos(cfg: { protocolo_max_anexos?: number | null; protocolo_max_mb?: number | null }) {
  const n = Math.min(Math.max(Math.floor(cfg.protocolo_max_anexos ?? 5), 0), LIMITE_MAX_ANEXOS);
  const mb = Math.min(Math.max(Math.floor(cfg.protocolo_max_mb ?? 10), 1), LIMITE_MAX_MB);
  return { max_anexos: n, max_bytes: mb * 1024 * 1024, max_mb: mb };
}

// ───────────── Permissões (puras) ─────────────

export type ParticipantesProtocolo = {
  criado_por_id: string | null;
  responsavel_id: string | null;
  destino_usuario_id: string | null;
  destino_setor_id: string | null;
  setor_atual_id: string | null;
  origem_setor_id: string | null;
};
export type AtorProtocolo = { papel: GedPapel; usuario_id: string; setor_ids: readonly string[] };

const tem = (papel: GedPapel, cap: "protocolar" | "protocolo_geral") =>
  cap === "protocolar" ? ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"].includes(papel) : ["GED_ADMIN", "GED_GESTOR", "GED_AUDITOR"].includes(papel);

/** Participa do protocolo: autor, responsável, destinatário ou integrante de um dos setores envolvidos. */
export function estaEnvolvido(a: AtorProtocolo, p: ParticipantesProtocolo): boolean {
  if ([p.criado_por_id, p.responsavel_id, p.destino_usuario_id].includes(a.usuario_id)) return true;
  return [p.destino_setor_id, p.setor_atual_id, p.origem_setor_id].some((s) => !!s && a.setor_ids.includes(s));
}
/** Pode ver o protocolo (ficha e andamento). Os anexos têm a sua própria checagem (whereGedVisivel). */
export const podeVerProtocolo = (a: AtorProtocolo, p: ParticipantesProtocolo) => tem(a.papel, "protocolo_geral") || estaEnvolvido(a, p);
/** Pode movimentar (analisar, encaminhar, responder, arquivar, devolver, indeferir). Leitor e Auditor nunca. */
export const podeAgirNoProtocolo = (a: AtorProtocolo, p: ParticipantesProtocolo) =>
  tem(a.papel, "protocolar") && (a.papel === "GED_ADMIN" || a.papel === "GED_GESTOR" || estaEnvolvido(a, p));
export const podeRegistrarProtocolo = (papel: GedPapel) => tem(papel, "protocolar");

/** Protocolos em que o ator está envolvido (autor, responsável, destinatário ou setor envolvido) – filtro "meus / do meu setor". */
export function whereProtocoloEnvolvido(a: AtorProtocolo): Prisma.GedProtocoloWhereInput {
  const setores = [...a.setor_ids];
  return {
    OR: [
      { criado_por_id: a.usuario_id },
      { responsavel_id: a.usuario_id },
      { destino_usuario_id: a.usuario_id },
      ...(setores.length ? [{ destino_setor_id: { in: setores } }, { setor_atual_id: { in: setores } }, { origem_setor_id: { in: setores } }] : []),
    ],
  };
}

/** Filtro de visibilidade do livro para listas (aplicado no SQL, nunca depois de paginar). */
export const whereProtocoloVisivel = (a: AtorProtocolo): Prisma.GedProtocoloWhereInput => (tem(a.papel, "protocolo_geral") ? {} : whereProtocoloEnvolvido(a));

/** Papéis que o teto GED permite receber trâmite (reflexo de TETO_ACOES) – o destino de um protocolo precisa poder tramitar. */
export const PAPEIS_QUE_RECEBEM = (Object.keys(TETO_ACOES) as GedPapel[]).filter((p) => TETO_ACOES[p].includes("TRAMITAR"));

// ───────────── Consulta pública (sem dados pessoais) ─────────────

/** Texto da linha do andamento mostrado ao interessado (nunca o despacho interno nem nomes de servidores). */
export function rotuloPublicoEvento(tipo: GedTipoEventoProtocolo, livro: GedLivroProtocolo = "ENTRADA"): string {
  switch (tipo) {
    case "REGISTRO": return livro === "ENTRADA" ? "Protocolo recebido pelo órgão" : "Protocolo registrado";
    case "ANALISE": return "Em análise";
    case "ENCAMINHAMENTO": return "Encaminhado para análise";
    case "RESPOSTA": return "Respondido";
    case "ARQUIVAMENTO": return "Arquivado";
    case "DEVOLUCAO": return "Devolvido";
    case "INDEFERIMENTO": return "Indeferido";
  }
}

/** Notifica o interessado (e-mail) nesta mudança? Registro e demais mudanças de situação sim; só "iniciar análise" não, por ruído. */
export const notificaInteressado = (tipo: GedTipoEventoProtocolo) => tipo !== "ANALISE";

/** Prazo de resposta a partir do assunto do portal (dias corridos, até o fim do dia). */
export function prazoPorDias(agora: Date, dias: number | null | undefined): Date | null {
  if (!dias || dias < 1) return null;
  const d = new Date(agora.getTime() + dias * 86_400_000);
  d.setUTCHours(23, 59, 0, 0);
  return d;
}

/** Texto padrão do aceite de LGPD exibido no formulário público. */
export const TEXTO_LGPD_PORTAL =
  "Declaro estar ciente de que meus dados pessoais (nome, CPF/CNPJ, e-mail e telefone) e os documentos enviados serão tratados pelo órgão exclusivamente para registrar, analisar e responder a este protocolo, conforme a Lei nº 13.709/2018 (LGPD).";

/** Ano civil em Brasília (UTC-3, sem horário de verão): a virada do ano de numeração acontece à meia-noite de Brasília. */
export const anoBrasilia = (d: Date = new Date()) => new Date(d.getTime() - 3 * 3600_000).getUTCFullYear();
