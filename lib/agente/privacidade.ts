// Regras de privacidade do agente (puras – tests/unit/agente-privacidade.test.ts).

/**
 * Situação de uma denúncia só é informada a quem a registrou: o hash do contato da conversa (telefone/e-mail)
 * precisa ser IGUAL ao hash gravado na denúncia. Sem hash de um dos lados → nega (não revela nem a existência).
 */
export function podeConsultarProtocolo(hashDenuncia: string | null | undefined, hashSolicitante: string | null | undefined): boolean {
  return !!hashDenuncia && !!hashSolicitante && hashDenuncia === hashSolicitante;
}

/** Limite de mensagens por contato (janela deslizante): padrão 20 mensagens em 10 minutos. */
export const LIMITE_MENSAGENS = { max: Number(process.env.AGENTE_LIMITE_MSGS ?? 20), janelaMs: 10 * 60 * 1000 };

export function excedeuLimiteContato(qtdNaJanela: number, max = LIMITE_MENSAGENS.max): boolean {
  return qtdNaJanela > max;
}
