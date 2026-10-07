// Limite de tentativas de login POR IP (SPEC 3) – complementa o bloqueio por conta (5 falhas → 15 min, lib/auth.ts).
// Conta somente FALHAS (senha errada, usuário inexistente/inativo, refresh token inválido): logins bem-sucedidos
// não consomem a cota, então vários usuários atrás do mesmo NAT (prefeitura) ou os testes E2E não são afetados.
//
// Janela deslizante EM MEMÓRIA (por processo). Com uma réplica (Railway) é suficiente; com várias réplicas cada
// uma conta separadamente (o limite efetivo vira N × LOGIN_LIMITE_IP) – para isso, limite também no proxy/WAF
// ou troque por uma tabela no Postgres.

const janelas = new Map<string, number[]>();
const MAX_CHAVES = 20_000;

const inteiro = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
};

/** Máximo de falhas por IP na janela (env LOGIN_LIMITE_IP, padrão 20). */
export const limiteFalhasIp = () => inteiro(process.env.LOGIN_LIMITE_IP, 20);
/** Janela em ms (env LOGIN_LIMITE_IP_JANELA_MIN, padrão 15 min). */
export const janelaFalhasIpMs = () => inteiro(process.env.LOGIN_LIMITE_IP_JANELA_MIN, 15) * 60_000;

export const MENSAGEM_MUITAS_TENTATIVAS = "Muitas tentativas. Aguarde alguns minutos.";

/** IP do cliente: 1º item do X-Forwarded-For (proxy do Railway), depois X-Real-IP; sem cabeçalho → "desconhecido". */
export function ipDaRequisicao(h: { get(nome: string): string | null }): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "desconhecido";
}

function vigentes(chave: string, agora: number, janela: number): number[] {
  const lista = (janelas.get(chave) ?? []).filter((t) => agora - t < janela);
  if (lista.length) janelas.set(chave, lista);
  else janelas.delete(chave);
  return lista;
}

/** O IP já atingiu o limite de falhas na janela? (não registra nada) */
export function ipBloqueado(chave: string, agora = Date.now(), max = limiteFalhasIp(), janela = janelaFalhasIpMs()): boolean {
  return vigentes(chave, agora, janela).length >= max;
}

/** Registra uma falha para o IP. Retorna quantas falhas há na janela (incluindo esta). */
export function registrarFalhaIp(chave: string, agora = Date.now(), janela = janelaFalhasIpMs()): number {
  const lista = vigentes(chave, agora, janela);
  lista.push(agora);
  janelas.set(chave, lista);
  if (janelas.size > MAX_CHAVES) limparExpirados(agora, janela);
  return lista.length;
}

/** Segundos até a falha mais antiga sair da janela (para o cabeçalho Retry-After). */
export function segundosParaLiberar(chave: string, agora = Date.now(), janela = janelaFalhasIpMs()): number {
  const lista = vigentes(chave, agora, janela);
  if (!lista.length) return 0;
  return Math.max(1, Math.ceil((lista[0] + janela - agora) / 1000));
}

/** Remove chaves sem falhas na janela (chamado automaticamente quando o mapa cresce demais). */
export function limparExpirados(agora = Date.now(), janela = janelaFalhasIpMs()) {
  for (const chave of [...janelas.keys()]) vigentes(chave, agora, janela);
  // Ainda grande (ataque distribuído): descarta tudo para não crescer sem limite.
  if (janelas.size > MAX_CHAVES) janelas.clear();
}

/** Somente para testes. */
export function _zerarLimites() {
  janelas.clear();
}
