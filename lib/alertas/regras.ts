// Regras puras do motor de alertas (SPEC 6.1) – sem acesso ao banco, testadas em tests/unit/alertas.test.ts.
import type { StatusProcesso } from "@prisma/client";
import { diasRestantes } from "../dias";
import { etapaAnalise, type Etapa } from "../prazos";

export type TipoAlerta =
  | "PRAZO_VENCENDO"
  | "PRAZO_VENCIDO"
  | "PENDENCIA_VENCENDO"
  | "PENDENCIA_VENCIDA"
  | "LICENCA_RENOVACAO"
  | "CONDICIONANTE"
  | "NOTIFICACAO"
  | "DESMATAMENTO";

/** ALERTA_DESMATAMENTO / MONITORAMENTO: avisos do monitoramento por satélite (lib/monitoramento/sync.ts). */
export type ReferenciaTipo = "PROCESSO" | "PENDENCIA" | "DOCUMENTO" | "CONDICIONANTE" | "NOTIFICACAO" | "ALERTA_DESMATAMENTO" | "MONITORAMENTO";

export const ROTULO_TIPO_ALERTA: Record<TipoAlerta, string> = {
  PRAZO_VENCENDO: "Prazo vencendo",
  PRAZO_VENCIDO: "Prazo vencido",
  PENDENCIA_VENCENDO: "Pendência vencendo",
  PENDENCIA_VENCIDA: "Pendência vencida",
  LICENCA_RENOVACAO: "Renovação de licença",
  CONDICIONANTE: "Condicionante",
  NOTIFICACAO: "Notificação",
  DESMATAMENTO: "Desmatamento (satélite)",
};

/** Status em que o relógio da etapa corre (SPEC 6). AGUARDANDO_REQUERENTE fica pausado. */
export const STATUS_COM_PRAZO: StatusProcesso[] = ["PROTOCOLADO", "EM_TRIAGEM", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO"];

/** Etapa de prazo_config correspondente ao status do processo. */
export function etapaDoStatus(status: StatusProcesso, tipoAto: { sigla: string; prazo_analise_dias: number }): Etapa | null {
  switch (status) {
    case "PROTOCOLADO":
    case "EM_TRIAGEM":
      return "TRIAGEM";
    case "EM_ANALISE":
      return etapaAnalise(tipoAto);
    case "AGUARDANDO_VISTORIA":
      return "VISTORIA";
    case "AGUARDANDO_DECISAO":
      return "DECISAO";
    case "AGUARDANDO_REQUERENTE":
      return "PENDENCIA";
    default:
      return null;
  }
}

export type SituacaoPrazo = "VENCIDO" | "VENCENDO" | "EM_DIA" | "PAUSADO" | "SEM_PRAZO";

/** Classifica um prazo em relação a `hoje` (dias corridos, comparação por dia civil). */
export function classificarPrazo(ate: Date | null | undefined, diasAlerta: number, pausado: boolean, hoje: Date): { situacao: SituacaoPrazo; dias: number | null } {
  if (pausado) return { situacao: "PAUSADO", dias: ate ? diasRestantes(ate, false, new Set(), hoje) : null };
  if (!ate) return { situacao: "SEM_PRAZO", dias: null };
  const dias = diasRestantes(ate, false, new Set(), hoje);
  if (dias < 0) return { situacao: "VENCIDO", dias };
  if (dias <= diasAlerta) return { situacao: "VENCENDO", dias };
  return { situacao: "EM_DIA", dias };
}

/** Aba da tela Prazos: vencidos / vencem em 7 dias / em dia / pausados. */
export type AbaPrazo = "vencidos" | "vencendo" | "em-dia" | "pausados";
export function abaDoPrazo(ate: Date | null | undefined, pausado: boolean, hoje: Date, janela = 7): AbaPrazo | null {
  if (pausado) return "pausados";
  if (!ate) return null;
  const d = diasRestantes(ate, false, new Set(), hoje);
  if (d < 0) return "vencidos";
  if (d <= janela) return "vencendo";
  return "em-dia";
}

/** Marcos de renovação de licença (dias antes do vencimento). */
export const MARCOS_RENOVACAO = [120, 60, 30] as const;

/**
 * Marco de renovação atingido: o menor marco ≥ dias restantes (ex.: 45 dias → 60).
 * Retorna "VENCIDA" se já venceu e null se ainda está a mais de 120 dias.
 */
export function marcoRenovacao(validadeAte: Date, hoje: Date, marcos: readonly number[] = MARCOS_RENOVACAO): number | "VENCIDA" | null {
  const d = diasRestantes(validadeAte, false, new Set(), hoje);
  if (d < 0) return "VENCIDA";
  const ordenados = [...marcos].sort((a, b) => a - b);
  for (const m of ordenados) if (d <= m) return m;
  return null;
}

/** Marco de prazo simples (pendência, condicionante, notificação): VENCENDO dentro da janela, VENCIDO após. */
export function marcoPrazo(ate: Date, diasAlerta: number, hoje: Date): "VENCENDO" | "VENCIDO" | null {
  const d = diasRestantes(ate, false, new Set(), hoje);
  if (d < 0) return "VENCIDO";
  if (d <= diasAlerta) return "VENCENDO";
  return null;
}

const dataIso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Chave de idempotência (alerta.chave UNIQUE): tipo + referência + destinatário + marco.
 * O marco inclui a data-limite, então um prazo recalculado gera novo alerta.
 */
export function chaveAlerta(tipo: TipoAlerta, referenciaId: string, destinatario: string, marco: string | number, ate?: Date | null): string {
  return [tipo, referenciaId, destinatario, String(marco), ate ? dataIso(ate) : "-"].join(":");
}

/** Destinatários internos de um alerta de processo: técnico + gestor do processo ou gestores do município (sem duplicatas). */
export function destinatariosProcesso(p: { tecnico_id: string | null; gestor_id: string | null }, gestoresMunicipio: string[]): string[] {
  const ids = [p.tecnico_id, ...(p.gestor_id ? [p.gestor_id] : gestoresMunicipio)].filter((x): x is string => !!x);
  return [...new Set(ids)];
}

export function mensagemPrazo(tipo: "VENCENDO" | "VENCIDO", numero: string, etapa: string, dias: number): string {
  if (tipo === "VENCIDO") return `Processo ${numero}: prazo da etapa ${etapa} vencido há ${-dias} dia(s).`;
  return dias === 0 ? `Processo ${numero}: prazo da etapa ${etapa} vence hoje.` : `Processo ${numero}: prazo da etapa ${etapa} vence em ${dias} dia(s).`;
}

/** Regra de arquivamento automático (SPEC 6): AGUARDANDO_REQUERENTE e pendência vencida há mais de `carenciaDias`. */
export function deveArquivarAutomatico(
  p: { status: StatusProcesso; pendencias: { status: string; prazo_ate: Date }[] },
  hoje: Date,
  carenciaDias = 0,
): boolean {
  if (p.status !== "AGUARDANDO_REQUERENTE") return false;
  const relevantes = p.pendencias.filter((x) => x.status === "ABERTA" || x.status === "VENCIDA");
  if (relevantes.length === 0) return false;
  // Só arquiva se TODAS as pendências relevantes venceram além da carência.
  return relevantes.every((x) => diasRestantes(x.prazo_ate, false, new Set(), hoje) < -carenciaDias);
}
