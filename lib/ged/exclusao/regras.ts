// Regras PURAS da exclusão controlada (sem banco/storage) – docs/ged.md §17. Testadas em tests/unit/ged-exclusao.test.ts.
//
// Princípios:
//   - o que tem valor jurídico/registro imutável NUNCA é excluído (trâmite, comentário, solicitação de assinatura de qualquer
//     situação, versão selada/assinatura, protocolo e comprovante); o banco também recusa (FK RESTRICT + triggers);
//   - exclusão de pasta/lote é TUDO-OU-NADA por padrão; "apenas os que podem" é uma opção explícita;
//   - só se exclui pasta VAZIA (os documentos saem antes; filhas antes das mães);
//   - a confirmação (nome da pasta ou EXCLUIR) é conferida também no servidor.
import type { GedStatusDocumento, GedTipoExclusao } from "@prisma/client";

// ───────────── Limites ─────────────

/** Até este nº de documentos E de pastas a exclusão roda na própria requisição; acima disso vai para o job `ged-excluir`. */
export const LIMITE_SINCRONO_DOCUMENTOS = 100;
export const LIMITE_SINCRONO_PASTAS = 100;
/** Documentos por transação (blocos); em falha do bloco cai para um por vez. */
export const TAMANHO_BLOCO_DOCUMENTOS = 100;
/** Pastas por transação. */
export const TAMANHO_BLOCO_PASTAS = 100;
/** Quantos documentos impeditivos a resposta lista (o total real vai em `bloqueados_total`). */
export const MAX_BLOQUEADOS_LISTADOS = 200;
/** Exclusão PROCESSANDO sem sinal de vida por este tempo é retomada pela varredura do job. */
export const STALE_EXCLUSAO_MS = 10 * 60 * 1000;
/** Palavra de confirmação de documento e de lote de importação. */
export const PALAVRA_CONFIRMACAO = "EXCLUIR";

export const modoSincrono = (documentos: number, pastas: number) => documentos <= LIMITE_SINCRONO_DOCUMENTOS && pastas <= LIMITE_SINCRONO_PASTAS;

export function emBlocos<T>(lista: readonly T[], tamanho: number): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error("tamanho de bloco inválido");
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

// ───────────── Impedimentos ─────────────

export type MotivoBloqueio = "ASSINATURA" | "SELADA" | "PROTOCOLO" | "TRAMITE" | "COMENTARIO" | "DERIVADO" | "SEM_PERMISSAO";
export const MOTIVOS_BLOQUEIO: readonly MotivoBloqueio[] = ["ASSINATURA", "SELADA", "PROTOCOLO", "TRAMITE", "COMENTARIO", "DERIVADO", "SEM_PERMISSAO"];

export const ROTULO_MOTIVO_BLOQUEIO: Record<MotivoBloqueio, string> = {
  ASSINATURA: "tem solicitação de assinatura (em andamento, concluída, recusada ou cancelada)",
  SELADA: "está assinado/selado (versão selada, selo ou código verificador)",
  PROTOCOLO: "está vinculado a um protocolo (anexo ou comprovante)",
  TRAMITE: "tem histórico de trâmite (registro imutável)",
  COMENTARIO: "tem comentários (registro imutável)",
  DERIVADO: "tem uma versão derivada (anonimizada) que não será excluída junto",
  SEM_PERMISSAO: "você não tem permissão para excluí-lo (é preciso Administrar e Ver o documento)",
};

/** Motivos que protegem o valor jurídico: nem o administrador contorna. */
export const MOTIVOS_JURIDICOS: readonly MotivoBloqueio[] = ["ASSINATURA", "SELADA", "PROTOCOLO", "TRAMITE", "COMENTARIO"];

export type FatosDocumentoExclusao = {
  status: GedStatusDocumento;
  codigo_verificador: string | null;
  tramites: number;
  comentarios: number;
  solicitacoes: number;
  versoes_seladas: number;
  /** Versões de origem SELO/COMPROVANTE (geradas pelo sistema como prova). */
  versoes_sistema: number;
  protocolo_anexos: number;
  protocolo_comprovantes: number;
  /** O usuário tem VER e ADMINISTRAR no documento? */
  permitido: boolean;
};

/** PURA: por que este documento não pode ser excluído (vazio = pode). */
export function motivosDeBloqueio(f: FatosDocumentoExclusao): MotivoBloqueio[] {
  const m: MotivoBloqueio[] = [];
  if (f.solicitacoes > 0 || f.status === "EM_ASSINATURA") m.push("ASSINATURA");
  if (f.status === "ASSINADO" || f.codigo_verificador !== null || f.versoes_seladas > 0 || f.versoes_sistema > 0) m.push("SELADA");
  if (f.protocolo_anexos > 0 || f.protocolo_comprovantes > 0) m.push("PROTOCOLO");
  if (f.tramites > 0) m.push("TRAMITE");
  if (f.comentarios > 0) m.push("COMENTARIO");
  if (!f.permitido) m.push("SEM_PERMISSAO");
  return m;
}

/**
 * PURA: acrescenta DERIVADO a quem tem versão derivada (anonimizada) que ficaria para trás – a derivada não está entre os
 * candidatos ou está bloqueada. Repete até estabilizar (derivada bloqueada bloqueia a original; a original nunca é apagada
 * deixando a derivada órfã). Altera e devolve `bloqueios`.
 */
export function propagarDerivados(candidatos: readonly string[], derivadasDe: ReadonlyMap<string, readonly string[]>, bloqueios: Map<string, MotivoBloqueio[]>): Map<string, MotivoBloqueio[]> {
  const set = new Set(candidatos);
  const bloqueado = (id: string) => (bloqueios.get(id)?.length ?? 0) > 0;
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const id of candidatos) {
      if (bloqueado(id)) continue;
      const ders = derivadasDe.get(id) ?? [];
      if (ders.some((d) => !set.has(d) || bloqueado(d))) {
        bloqueios.set(id, [...(bloqueios.get(id) ?? []), "DERIVADO"]);
        mudou = true;
      }
    }
  }
  return bloqueios;
}

/** PURA: derivados (documento_original_id preenchido) primeiro, depois os demais; estável dentro de cada grupo. */
export function ordenarParaExclusao<T extends { id: string; documento_original_id: string | null }>(docs: readonly T[]): T[] {
  return [...docs.filter((d) => d.documento_original_id !== null), ...docs.filter((d) => d.documento_original_id === null)];
}

export function contarMotivos(lista: readonly { motivos: readonly MotivoBloqueio[] }[]): Record<MotivoBloqueio, number> {
  const out = Object.fromEntries(MOTIVOS_BLOQUEIO.map((m) => [m, 0])) as Record<MotivoBloqueio, number>;
  for (const x of lista) for (const m of new Set(x.motivos)) out[m]++;
  return out;
}

/** Texto curto de um impedimento ("tem comentários (…); está assinado…"). */
export const textoMotivos = (motivos: readonly MotivoBloqueio[]) => [...new Set(motivos)].map((m) => ROTULO_MOTIVO_BLOQUEIO[m]).join("; ");

export function mensagemBloqueio(totalBloqueados: number, porMotivo: Record<MotivoBloqueio, number>): string {
  const partes = MOTIVOS_BLOQUEIO.filter((m) => porMotivo[m] > 0).map((m) => `${porMotivo[m]} ${ROTULO_MOTIVO_BLOQUEIO[m]}`);
  const quantos = totalBloqueados === 1 ? "1 documento não pode" : `${totalBloqueados} documentos não podem`;
  return `Nada foi excluído: ${quantos} ser excluído${totalBloqueados === 1 ? "" : "s"} (${partes.join("; ")}). Documentos com valor jurídico ou registro imutável não se excluem. Você pode excluir apenas os que podem, mantendo os demais.`;
}

// ───────────── Decisão do plano ─────────────

export type DecisaoPlano = { ok: true } | { ok: false; motivo: "BLOQUEADO" | "NADA_A_EXCLUIR" };

/** PURA: tudo-ou-nada recusa qualquer impeditivo; "apenas os que podem" recusa só se não sobrar nada a excluir. */
export function decidirPlano(p: { excluiveis: number; bloqueados: number; pastas_removiveis: number }, apenasPossiveis: boolean): DecisaoPlano {
  if (!apenasPossiveis && p.bloqueados > 0) return { ok: false, motivo: "BLOQUEADO" };
  if (p.excluiveis === 0 && p.pastas_removiveis === 0) return { ok: false, motivo: "NADA_A_EXCLUIR" };
  return { ok: true };
}

// ───────────── Confirmação ─────────────

/** O que o usuário precisa digitar: o nome da pasta, ou EXCLUIR (documento e lote). */
export function confirmacaoEsperada(tipo: GedTipoExclusao, nomePasta: string | null): string {
  return tipo === "PASTA" && nomePasta ? nomePasta : PALAVRA_CONFIRMACAO;
}

export function confirmacaoValida(esperada: string, digitada: unknown): boolean {
  return typeof digitada === "string" && digitada.trim() === esperada.trim() && esperada.trim().length > 0;
}

// ───────────── Pastas ─────────────

export type PastaCandidata = { id: string; parent_id: string | null; profundidade: number };

/** PURA: filhas antes das mães (mais profundas primeiro; desempate por id para ser determinístico). */
export function ordenarPastasFilhasPrimeiro<T extends { id: string; profundidade: number }>(pastas: readonly T[]): T[] {
  return [...pastas].sort((a, b) => b.profundidade - a.profundidade || a.id.localeCompare(b.id));
}

/**
 * PURA: quais pastas candidatas podem ser removidas, na ordem de remoção (filhas primeiro). Uma pasta só sai se NÃO está
 * ocupada (documento restante, subpasta fora das candidatas, sem permissão) e se todas as candidatas filhas também saem.
 */
export function pastasRemoviveis(candidatas: readonly PastaCandidata[], ocupadas: ReadonlySet<string>): PastaCandidata[] {
  const filhas = new Map<string, string[]>();
  for (const p of candidatas) if (p.parent_id) filhas.set(p.parent_id, [...(filhas.get(p.parent_id) ?? []), p.id]);
  const decisao = new Map<string, boolean>();
  for (const p of ordenarPastasFilhasPrimeiro(candidatas)) {
    const ok = !ocupadas.has(p.id) && (filhas.get(p.id) ?? []).every((f) => decisao.get(f) === true);
    decisao.set(p.id, ok);
  }
  return ordenarPastasFilhasPrimeiro(candidatas).filter((p) => decisao.get(p.id) === true);
}

/**
 * PURA: pastas que um LOTE de importação criou e que podem ser candidatas à remoção quando ficarem vazias. O lote não guarda
 * quais pastas criou; usa-se: ancestrais-ou-próprias das pastas dos itens importados, criadas a partir do início do lote, abaixo
 * da pasta de destino (nunca o destino nem seus ancestrais). Pasta já existente antes do lote (created_at anterior) nunca entra.
 */
export function pastasCriadasPeloLote(
  pastas: readonly { id: string; caminho_ids: readonly string[]; created_at: Date }[],
  destino: { id: string | null; caminho_ids: readonly string[] },
  loteCriadoEm: Date,
): string[] {
  return pastas
    .filter((p) => p.created_at.getTime() >= loteCriadoEm.getTime())
    .filter((p) => p.id !== destino.id && !destino.caminho_ids.includes(p.id))
    .filter((p) => destino.id === null || p.caminho_ids.includes(destino.id))
    .map((p) => p.id);
}

/** Todas as pastas ancestrais-ou-próprias (ids) das pastas informadas, a partir do caminho materializado. */
export function ancestraisOuProprias(pastas: readonly { caminho_ids: readonly string[] }[]): string[] {
  return [...new Set(pastas.flatMap((p) => p.caminho_ids))];
}

// ───────────── Tipos compartilhados (plano/resposta) ─────────────

export type DocumentoBloqueado = { id: string | null; numero: string | null; titulo: string | null; pasta: string | null; motivos: MotivoBloqueio[] };

export type PlanoExclusaoPublico = {
  alvo: { tipo: GedTipoExclusao; id: string; rotulo: string };
  /** O que digitar para confirmar. */
  confirmacao_esperada: string;
  documentos_total: number;
  documentos_excluiveis: number;
  versoes: number;
  bytes: number;
  pastas_total: number;
  /** Pastas que serão removidas (já considerando o que sobra no modo "apenas os que podem"). */
  pastas_removiveis: number;
  bloqueados_total: number;
  /** Documentos sem permissão que o usuário nem enxerga: só contados (sem número/título). */
  sem_permissao_total: number;
  bloqueados: DocumentoBloqueado[];
  motivos: Record<MotivoBloqueio, number>;
  sincrono: boolean;
  /** Mensagem pronta quando há impedimentos. */
  mensagem_bloqueio: string | null;
};

export const fmtMb = (bytes: number) => `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
