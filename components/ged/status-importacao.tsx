import { Badge } from "@/components/ui";

export const ROTULO_STATUS_IMPORTACAO: Record<string, string> = {
  RECEBENDO: "Aguardando envio",
  PENDENTE: "Na fila",
  PROCESSANDO: "Processando",
  CONCLUIDA: "Concluída",
  CONCLUIDA_COM_ERROS: "Concluída com erros",
  FALHOU: "Falhou",
};
export const EM_ANDAMENTO = ["PENDENTE", "PROCESSANDO"];

const COR: Record<string, "verde" | "amarelo" | "vermelho" | "azul" | "cinza"> = { RECEBENDO: "amarelo", PENDENTE: "cinza", PROCESSANDO: "azul", CONCLUIDA: "verde", CONCLUIDA_COM_ERROS: "amarelo", FALHOU: "vermelho" };

export function StatusImportacao({ status }: { status: string }) {
  return <Badge cor={COR[status] ?? "cinza"}>{ROTULO_STATUS_IMPORTACAO[status] ?? status}</Badge>;
}
