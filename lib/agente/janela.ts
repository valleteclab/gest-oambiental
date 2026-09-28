// Janela de atendimento da API oficial do WhatsApp (Cloud API): fora de 24 h da última mensagem do cidadão,
// só é possível enviar template aprovado pela Meta. Puro – testado em tests/unit/agente.test.ts.
export const JANELA_OFICIAL_MS = 24 * 3600 * 1000;

export function foraDaJanela(ultimaMsgCidadao: Date | null | undefined, agora = Date.now()): boolean {
  return !ultimaMsgCidadao || agora - ultimaMsgCidadao.getTime() > JANELA_OFICIAL_MS;
}
