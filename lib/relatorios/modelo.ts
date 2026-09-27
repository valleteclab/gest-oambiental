// Modelo genérico de relatório tabular – renderizado em PDF (lib/relatorios/pdf.ts) e XLSX (lib/relatorios/xlsx.ts).

export type TipoColuna = "texto" | "inteiro" | "decimal" | "moeda" | "data" | "datahora" | "percentual";

export type Coluna = { chave: string; titulo: string; tipo?: TipoColuna; largura?: number };

export type Celula = string | number | Date | null | undefined | boolean;

export type Secao = {
  titulo: string;
  colunas: Coluna[];
  linhas: Record<string, Celula>[];
  /** Linha de totais (opcional) – mesmas chaves das colunas. */
  total?: Record<string, Celula>;
  nota?: string;
};

export type Relatorio = {
  tipo: string;
  titulo: string;
  paisagem: boolean;
  /** Pares rótulo/valor dos filtros aplicados (cabeçalho institucional). */
  filtros: [string, string][];
  /** Indicadores de resumo (rótulo, valor já formatado). */
  resumo?: [string, string][];
  secoes: Secao[];
};

export type Cabecalho = {
  organizacao: string;
  organizacao_sigla: string;
  municipio: string;
  emitido_em: Date;
  usuario: string;
};

export const TIPOS_RELATORIO = [
  { tipo: "processos", titulo: "Processos por período, status e tipo", descricao: "Processos protocolados no período, com resumo por status e por tipo de ato." },
  { tipo: "licencas", titulo: "Licenças emitidas e vencimentos", descricao: "Licenças, autorizações e certidões emitidas no período e as que vencem nos próximos 90 dias." },
  { tipo: "fiscalizacao", titulo: "Fiscalização", descricao: "Denúncias, vistorias, autos de infração e notificações do período." },
  { tipo: "produtividade", titulo: "Produtividade por técnico", descricao: "Processos atribuídos e concluídos, pareceres emitidos, tempo médio e prazos vencidos por técnico." },
  { tipo: "indicadores", titulo: "Indicadores por município", descricao: "Quadro consolidado por município (mesmos números do painel) – SISMUMAS/GAC." },
] as const;

export type TipoRelatorio = (typeof TIPOS_RELATORIO)[number]["tipo"];

export function ehTipoRelatorio(t: string): t is TipoRelatorio {
  return TIPOS_RELATORIO.some((r) => r.tipo === t);
}
