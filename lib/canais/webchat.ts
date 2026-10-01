// Chat do site (widget público em /denuncia e /orgao/[sigla]). As mensagens entram pela rota
// /api/v1/public/chat/mensagens (não por webhook) e as respostas ficam no banco – o widget lê por polling.
import type { Provedor } from "./tipos";

export const webchat: Provedor = {
  tipo: "WEBCHAT",
  oficial: () => false,
  limitarRitmo: false,
  verifyWebhook: () => false,
  parseWebhook: () => [],
  async sendText() {
    return { providerMessageId: null };
  },
};
