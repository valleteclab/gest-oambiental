// Anti-abuso simples para o formulário público de denúncia: limite por IP em memória (janela deslizante).
// Em produção com várias instâncias, trocar por limite no proxy/WAF ou tabela no Postgres.
const janelas = new Map<string, number[]>();

export function excedeuLimite(chave: string, max = 5, janelaMs = 10 * 60 * 1000, agora = Date.now()): boolean {
  const lista = (janelas.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (lista.length >= max) {
    janelas.set(chave, lista);
    return true;
  }
  lista.push(agora);
  janelas.set(chave, lista);
  if (janelas.size > 10000) janelas.clear();
  return false;
}

/** Tempo mínimo de preenchimento (robôs enviam instantaneamente). */
export const TEMPO_MINIMO_MS = 3000;
export const TAMANHO_MAX_CORPO = 20 * 1024; // 20 KB
