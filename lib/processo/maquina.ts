import type { StatusProcesso } from "@prisma/client";
import { can, isSomenteLeitura, temPapel, type Acao, type UsuarioSessao } from "../rbac";

// Máquina de estados do processo de licenciamento (SPEC 6) – parte PURA (sem banco), coberta por testes.
// A execução das transições fica em ./transicionar.ts (única forma de mudar o status).

export const ACOES_PROCESSO = [
  "protocolar",
  "distribuir",
  "pendencia",
  "responder",
  "aceitar",
  "agendar_vistoria",
  "concluir_vistoria",
  "parecer",
  "deferir",
  "indeferir",
  "emitir_documento",
  "arquivar",
] as const;

export type AcaoProcesso = (typeof ACOES_PROCESSO)[number];

/** Aceita apelidos usados na API/SPEC (ex.: "concluir" → emitir_documento). */
export function normalizarAcao(a: string): AcaoProcesso | null {
  const x = a.trim().toLowerCase().replace(/-/g, "_");
  if (x === "concluir") return "emitir_documento";
  if (x === "vistoria" || x === "agendar") return "agendar_vistoria";
  return (ACOES_PROCESSO as readonly string[]).includes(x) ? (x as AcaoProcesso) : null;
}

export const ROTULO_ACAO: Record<AcaoProcesso, string> = {
  protocolar: "Protocolar",
  distribuir: "Distribuir",
  pendencia: "Abrir pendência",
  responder: "Responder pendência",
  aceitar: "Aceitar (iniciar análise)",
  agendar_vistoria: "Agendar vistoria",
  concluir_vistoria: "Concluir vistoria",
  parecer: "Emitir parecer",
  deferir: "Deferir",
  indeferir: "Indeferir",
  emitir_documento: "Emitir documento",
  arquivar: "Arquivar",
};

/** Rótulos de status (cópia de components/ui ROTULO_STATUS para uso em código de servidor/jobs sem React). */
export const ROTULO_STATUS_PROCESSO: Record<StatusProcesso, string> = {
  RASCUNHO: "Rascunho",
  PROTOCOLADO: "Protocolado",
  EM_TRIAGEM: "Em triagem",
  AGUARDANDO_REQUERENTE: "Aguardando requerente",
  EM_ANALISE: "Em análise",
  AGUARDANDO_VISTORIA: "Aguardando vistoria",
  AGUARDANDO_DECISAO: "Aguardando decisão",
  DEFERIDO: "Deferido",
  INDEFERIDO: "Indeferido",
  CONCLUIDO: "Concluído",
  ARQUIVADO: "Arquivado",
};

/** Status em que o processo está "em andamento" (relógio correndo ou pausado). */
export const STATUS_ATIVOS: StatusProcesso[] = ["PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO"];
export const STATUS_FINAIS: StatusProcesso[] = ["CONCLUIDO", "ARQUIVADO"];

type Regra = {
  de: StatusProcesso[];
  /** Destino fixo; "ORIGEM" = volta à etapa de onde veio a pendência; "MESMO" = mantém (redistribuição). */
  para: StatusProcesso | "ORIGEM" | ((atual: StatusProcesso) => StatusProcesso);
};

/** Tabela de transições permitidas (SPEC 6). */
export const TRANSICOES: Record<AcaoProcesso, Regra> = {
  protocolar: { de: ["RASCUNHO"], para: "PROTOCOLADO" },
  // De PROTOCOLADO inicia a triagem; nos demais estados ativos apenas redistribui o técnico.
  distribuir: { de: ["PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO"], para: (s) => (s === "PROTOCOLADO" ? "EM_TRIAGEM" : s) },
  pendencia: { de: ["EM_TRIAGEM", "EM_ANALISE"], para: "AGUARDANDO_REQUERENTE" },
  responder: { de: ["AGUARDANDO_REQUERENTE"], para: "ORIGEM" },
  aceitar: { de: ["EM_TRIAGEM"], para: "EM_ANALISE" },
  agendar_vistoria: { de: ["EM_ANALISE"], para: "AGUARDANDO_VISTORIA" },
  concluir_vistoria: { de: ["AGUARDANDO_VISTORIA"], para: "EM_ANALISE" },
  parecer: { de: ["EM_ANALISE"], para: "AGUARDANDO_DECISAO" },
  // Decisão direta de EM_ANALISE só quando o tipo de ato não exige parecer (validado em pré-requisito).
  deferir: { de: ["AGUARDANDO_DECISAO", "EM_ANALISE"], para: "DEFERIDO" },
  indeferir: { de: ["AGUARDANDO_DECISAO", "EM_ANALISE"], para: "INDEFERIDO" },
  emitir_documento: { de: ["DEFERIDO", "INDEFERIDO"], para: "CONCLUIDO" },
  arquivar: { de: ["RASCUNHO", ...STATUS_ATIVOS, "DEFERIDO", "INDEFERIDO"], para: "ARQUIVADO" },
};

/** Status de destino da ação a partir do status atual (null = transição não permitida). */
export function destino(acao: AcaoProcesso, atual: StatusProcesso, origemPendencia?: StatusProcesso | null): StatusProcesso | null {
  const r = TRANSICOES[acao];
  if (!r.de.includes(atual)) return null;
  if (r.para === "ORIGEM") return origemPendencia === "EM_ANALISE" ? "EM_ANALISE" : "EM_TRIAGEM";
  return typeof r.para === "function" ? r.para(atual) : r.para;
}

/** Dados mínimos do processo para decidir permissões/ações disponíveis. */
export type ContextoAcao = {
  status: StatusProcesso;
  municipio_id: string;
  requerente_id: string;
  rt_pessoa_id?: string | null;
  /** municipio.delega_decisao – TEC_CONSORCIO pode decidir */
  delega_decisao?: boolean;
  /** tipo_ato.exige_parecer */
  exige_parecer?: boolean;
  /** Demanda urbana com decisão simplificada (lib/demandas decisaoPeloTecnico): o técnico do município também decide. */
  decisao_tecnico?: boolean;
};

export function ehTitular(u: UsuarioSessao, p: Pick<ContextoAcao, "requerente_id" | "rt_pessoa_id">): boolean {
  if (!u.pessoa_id) return false;
  return p.requerente_id === u.pessoa_id || (!!p.rt_pessoa_id && p.rt_pessoa_id === u.pessoa_id);
}

/** Ação RBAC (lib/rbac) exigida por cada ação do processo. */
const RBAC: Record<AcaoProcesso, Acao> = {
  protocolar: "criar",
  distribuir: "triar",
  pendencia: "pendencia",
  responder: "pendencia",
  aceitar: "triar",
  agendar_vistoria: "analisar",
  concluir_vistoria: "analisar",
  parecer: "parecer",
  deferir: "decidir",
  indeferir: "decidir",
  emitir_documento: "emitir_documento",
  arquivar: "triar",
};

/** O usuário tem permissão (perfil + escopo de município/titularidade) para a ação? Não verifica o estado. */
export function permitido(u: UsuarioSessao, acao: AcaoProcesso, p: ContextoAcao): boolean {
  if (isSomenteLeitura(u)) return false;
  const titular = ehTitular(u, p) && temPapel(u, "REQUERENTE");
  // Ações do requerente sobre o próprio processo
  if (titular && (acao === "protocolar" || acao === "responder")) return true;
  if (titular && acao === "arquivar" && p.status === "RASCUNHO") return true; // desistência do rascunho
  // Demais ações: somente perfis internos com escopo no município (REQUERENTE nunca decide/tramita)
  const interno = u.papeis.some((x) => x.papel !== "REQUERENTE");
  if (!interno) return false;
  const semRequerente: UsuarioSessao = { ...u, papeis: u.papeis.filter((x) => x.papel !== "REQUERENTE") };
  if (acao === "deferir" || acao === "indeferir") {
    if (can(semRequerente, "decidir", "processo", p.municipio_id)) return true;
    if (p.decisao_tecnico && can(semRequerente, "analisar", "processo", p.municipio_id)) return true;
    return !!p.delega_decisao && temPapel(semRequerente, "TEC_CONSORCIO");
  }
  if (acao === "emitir_documento") return can(semRequerente, "emitir_documento", "processo", p.municipio_id) || can(semRequerente, "decidir", "processo", p.municipio_id);
  return can(semRequerente, RBAC[acao], "processo", p.municipio_id);
}

/** Ações disponíveis (estado + perfil) – usado para exibir os botões. */
export function acoesDisponiveis(p: ContextoAcao, u: UsuarioSessao): AcaoProcesso[] {
  return ACOES_PROCESSO.filter((a) => {
    if (!destino(a, p.status)) return false;
    // Deferir direto da análise só quando o tipo de ato dispensa parecer (SPEC 6 regra 1)
    if (a === "deferir" && p.status === "EM_ANALISE" && p.exige_parecer !== false) return false;
    return permitido(u, a, p);
  });
}

/** Etapa de prazo (lib/prazos) correspondente a cada status. */
export function etapaDoStatus(s: StatusProcesso, etapaAnalise: "ANALISE_CURTA" | "ANALISE_LONGA"): "TRIAGEM" | "ANALISE_CURTA" | "ANALISE_LONGA" | "PENDENCIA" | "VISTORIA" | "DECISAO" | null {
  switch (s) {
    case "PROTOCOLADO":
    case "EM_TRIAGEM":
      return "TRIAGEM";
    case "EM_ANALISE":
      return etapaAnalise;
    case "AGUARDANDO_REQUERENTE":
      return "PENDENCIA";
    case "AGUARDANDO_VISTORIA":
      return "VISTORIA";
    case "AGUARDANDO_DECISAO":
      return "DECISAO";
    default:
      return null;
  }
}

// ───────────── Checklist ─────────────

/** `opcoes` (opcional, itens TEXTO): resposta deve ser uma das opções (ex.: recomendação poda/corte/indeferir). */
export type ItemChecklist = { id: string; texto: string; tipo: "SIM_NAO" | "TEXTO" | "NUMERO"; obrigatorio?: boolean; opcoes?: string[] };

export function lerItensChecklist(json: unknown): ItemChecklist[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => {
      const tipo = (["SIM_NAO", "TEXTO", "NUMERO"].includes(String(i.tipo)) ? i.tipo : "TEXTO") as ItemChecklist["tipo"];
      const opcoes = tipo === "TEXTO" && Array.isArray(i.opcoes) ? i.opcoes.map(String).filter(Boolean) : [];
      return { id: String(i.id ?? ""), texto: String(i.texto ?? ""), tipo, obrigatorio: !!i.obrigatorio, ...(opcoes.length ? { opcoes } : {}) };
    })
    .filter((i) => i.id);
}

/** Itens obrigatórios não respondidos (ou com valor inválido). */
export function itensChecklistPendentes(itens: ItemChecklist[], respostas: Record<string, unknown> | null | undefined): ItemChecklist[] {
  const r = respostas ?? {};
  return itens.filter((i) => {
    const v = r[i.id];
    const vazio = v === undefined || v === null || String(v).trim() === "";
    if (i.tipo === "NUMERO" && !vazio && !Number.isFinite(Number(String(v).replace(",", ".")))) return true;
    if (i.tipo === "SIM_NAO" && !vazio && !["SIM", "NAO", "NA"].includes(String(v))) return true;
    if (i.opcoes?.length && !vazio && !i.opcoes.includes(String(v))) return true;
    return !!i.obrigatorio && vazio;
  });
}

// ───────────── Distribuição por rodízio ─────────────

/** Próximo técnico do rodízio: quem recebeu distribuição há mais tempo (nunca recebeu = primeiro); empate por nome. */
export function proximoDoRodizio<T extends { id: string; nome: string; ultima: Date | null }>(candidatos: T[]): T | null {
  if (!candidatos.length) return null;
  return [...candidatos].sort((a, b) => {
    const ta = a.ultima?.getTime() ?? -Infinity;
    const tb = b.ultima?.getTime() ?? -Infinity;
    if (ta !== tb) return ta - tb;
    return a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id);
  })[0];
}
