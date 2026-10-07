// Rótulos e listas do protocolo SEM dependências de servidor (seguro em componentes cliente).
import type { GedLivroProtocolo, GedPrioridadeProtocolo } from "@prisma/client";

export const LIVROS: readonly GedLivroProtocolo[] = ["ENTRADA", "SAIDA", "INTERNO"];
export const ROTULO_LIVRO: Record<GedLivroProtocolo, string> = { ENTRADA: "Entrada", SAIDA: "Saída", INTERNO: "Interno" };
export const PRIORIDADES: readonly GedPrioridadeProtocolo[] = ["BAIXA", "NORMAL", "ALTA", "URGENTE"];
export const ROTULO_PRIORIDADE: Record<GedPrioridadeProtocolo, string> = { BAIXA: "Baixa", NORMAL: "Normal", ALTA: "Alta", URGENTE: "Urgente" };
