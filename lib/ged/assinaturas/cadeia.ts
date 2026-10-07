// Cadeia de hashes das assinaturas (docs/ged-design.md §3, item 4) – funções PURAS (sem banco), testadas em
// tests/unit/ged-assinaturas.test.ts.
//
//   hash_cadeia(i) = sha256( hash_cadeia(i-1) | assinante_id | usuario_id | hash_documento | assinado_em (ISO 8601 UTC) | metodo )
//
// O primeiro elo usa `sha256_alvo` (hash do arquivo que foi enviado para assinatura) no lugar de `hash_cadeia(i-1)`.
// A ordem dos elos é a ORDEM CRONOLÓGICA das assinaturas (assinado_em; o serviço garante instantes estritamente
// crescentes dentro da solicitação). Alterar qualquer campo, o horário, a ordem ou o hash de uma linha quebra o elo
// dela e de todas as seguintes – `verificarCadeia` aponta onde.
import { createHash } from "node:crypto";

export const SEPARADOR_CADEIA = "|";

export type ElementosElo = {
  assinante_id: string;
  usuario_id: string;
  hash_documento: string;
  assinado_em: Date | string;
  metodo: string;
};

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();

export const sha256Texto = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Hash do elo a partir do hash do elo anterior (ou `sha256_alvo` no primeiro). */
export function hashElo(anterior: string, e: ElementosElo): string {
  return sha256Texto([anterior, e.assinante_id, e.usuario_id, e.hash_documento, iso(e.assinado_em), e.metodo].join(SEPARADOR_CADEIA));
}

export type LinhaCadeia = ElementosElo & {
  ordem: number;
  status: string;
  hash_cadeia: string | null;
};

/** Ordem cronológica das assinaturas (empate: ordem do signatário, depois id – só para ser determinístico). */
export function ordenarCronologico<T extends { assinado_em: Date | string | null; ordem: number; assinante_id?: string }>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    const ta = a.assinado_em ? new Date(a.assinado_em).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.assinado_em ? new Date(b.assinado_em).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb || a.ordem - b.ordem || String(a.assinante_id ?? "").localeCompare(String(b.assinante_id ?? ""));
  });
}

export type ErroCadeia = { assinante_id: string; campo: "hash_cadeia" | "hash_documento" | "dados"; mensagem: string };
export type ResultadoCadeia = { ok: boolean; erros: ErroCadeia[]; elos: number; ultimo_hash: string | null };

/**
 * Recalcula a cadeia a partir das linhas ASSINADO e compara com o que está gravado. Não confia no gravado:
 * cada elo é recomputado com o hash anterior RECALCULADO.
 */
export function verificarCadeia(sha256_alvo: string, linhas: Array<Omit<LinhaCadeia, "assinado_em"> & { assinado_em: Date | string | null }>): ResultadoCadeia {
  const erros: ErroCadeia[] = [];
  const assinadas = linhas.filter((l) => l.status === "ASSINADO");
  let anterior = sha256_alvo;
  let n = 0;
  for (const l of ordenarCronologico(assinadas)) {
    if (!l.assinado_em || !l.hash_documento || !l.hash_cadeia || !l.metodo) {
      erros.push({ assinante_id: l.assinante_id, campo: "dados", mensagem: "Registro de assinatura incompleto." });
      continue;
    }
    if (l.hash_documento !== sha256_alvo) {
      erros.push({ assinante_id: l.assinante_id, campo: "hash_documento", mensagem: "O hash do arquivo assinado difere do hash do documento enviado para assinatura." });
    }
    const esperado = hashElo(anterior, { ...l, assinado_em: l.assinado_em });
    if (esperado !== l.hash_cadeia) {
      erros.push({ assinante_id: l.assinante_id, campo: "hash_cadeia", mensagem: "O elo da cadeia de hashes não confere (registro alterado ou fora de ordem)." });
    }
    // continua a partir do hash RECALCULADO: uma adulteração localizada não "conserta" os elos seguintes
    anterior = esperado;
    n++;
  }
  return { ok: erros.length === 0, erros, elos: n, ultimo_hash: n ? anterior : null };
}
