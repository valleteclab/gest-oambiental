/** URL pública do webhook do Asaas para o município: {APP_URL}/api/v1/webhooks/asaas/{token}. */
export function urlWebhookAsaas(token: string): string {
  return `${(process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "")}/api/v1/webhooks/asaas/${token}`;
}
