import "server-only";
import type { ConfigCobranca } from "@prisma/client";
import { decifrar } from "../crypto";
import { chaveSandbox, type PagamentoAsaas } from "./regras";

// Cliente HTTP do Asaas (API v3) – conta Asaas DO MUNICÍPIO (o dinheiro cai direto na conta da prefeitura).
// Auth: header `access_token`. Chave `…_hmlg_…` ⇒ sandbox. A chave (cifrada em config_cobranca) nunca sai do servidor.
// Docs: https://docs.asaas.com/

const PROD = "https://api.asaas.com/v3";
const SANDBOX = "https://api-sandbox.asaas.com/v3";
const TIMEOUT_MS = 20000;

export type AsaasRuntime = { apiKey: string; sandbox: boolean };

/** Runtime a partir da configuração do município (null sem chave). */
export function runtimeAsaas(cfg: Pick<ConfigCobranca, "asaas_api_key_cifrada" | "asaas_sandbox">): AsaasRuntime | null {
  const apiKey = decifrar(cfg.asaas_api_key_cifrada);
  if (!apiKey) return null;
  return { apiKey, sandbox: cfg.asaas_sandbox };
}

export function baseUrlAsaas(rt: AsaasRuntime): string {
  // O prefixo da chave manda (hmlg = sandbox); a flag reforça.
  return rt.sandbox || chaveSandbox(rt.apiKey) ? SANDBOX : PROD;
}

export class ErroAsaas extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function asaas<T>(rt: AsaasRuntime, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrlAsaas(rt)}${path}`, {
      method,
      headers: { "Content-Type": "application/json", access_token: rt.apiKey, "User-Agent": "LicenciaGov" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new ErroAsaas(`Falha de comunicação com o Asaas (${(e as Error).name === "TimeoutError" ? "tempo esgotado" : (e as Error).message}).`, 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const erros = (data?.errors as { description?: string }[] | undefined)?.map((e) => e.description).filter(Boolean);
    const msg = res.status === 401 ? "Chave da API do Asaas inválida ou sem permissão (HTTP 401)." : erros?.length ? erros.join(" | ") : `Asaas ${method} ${path.split("?")[0]} falhou (HTTP ${res.status}).`;
    throw new ErroAsaas(msg, res.status);
  }
  return data as T;
}

/** Reaproveita o cliente pelo CPF/CNPJ ou cria (notificações do Asaas desligadas – o LicenciaGov avisa o requerente). */
export async function garantirCliente(rt: AsaasRuntime, input: { nome: string; cpfCnpj: string; email?: string | null; externalReference: string }): Promise<string> {
  const achado = await asaas<{ data?: { id: string }[] }>(rt, "GET", `/customers?cpfCnpj=${encodeURIComponent(input.cpfCnpj)}&limit=1`).catch(() => ({ data: [] }));
  if (achado.data?.[0]?.id) return achado.data[0].id;
  const cli = await asaas<{ id: string }>(rt, "POST", "/customers", {
    name: input.nome.slice(0, 100),
    cpfCnpj: input.cpfCnpj,
    email: input.email || undefined,
    externalReference: input.externalReference,
    notificationDisabled: true,
  });
  return cli.id;
}

export type NovaCobrancaAsaas = {
  customerId: string;
  valor: number;
  vencimento: string; // YYYY-MM-DD
  descricao: string;
  externalReference: string;
  multaPercentual?: number | null;
  jurosMensalPercentual?: number | null;
};

export type CobrancaCriadaAsaas = {
  id: string;
  status: string;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pix: { payload: string | null; qrBase64: string | null; expiraEm: string | null };
  linhaDigitavel: string | null;
};

/**
 * Cria a cobrança com billingType UNDEFINED (o pagador escolhe Pix, boleto ou cartão na fatura – invoiceUrl) e
 * busca o QR Pix e a linha digitável. Falhas nas consultas auxiliares não invalidam a cobrança (a fatura basta).
 */
export async function criarCobranca(rt: AsaasRuntime, input: NovaCobrancaAsaas): Promise<CobrancaCriadaAsaas> {
  // Idempotência: nova tentativa após falha parcial reaproveita a cobrança já criada (externalReference = id local).
  const existente = await asaas<{ data?: { id: string; status: string; invoiceUrl?: string; bankSlipUrl?: string; deleted?: boolean }[] }>(rt, "GET", `/payments?externalReference=${encodeURIComponent(input.externalReference)}&limit=5`).catch(() => ({ data: [] }));
  const reaproveitar = existente.data?.find((p) => !p.deleted);
  const pay = reaproveitar ?? await asaas<{ id: string; status: string; invoiceUrl?: string; bankSlipUrl?: string }>(rt, "POST", "/payments", {
    customer: input.customerId,
    billingType: "UNDEFINED",
    value: Math.round(input.valor * 100) / 100,
    dueDate: input.vencimento,
    description: input.descricao.slice(0, 500),
    externalReference: input.externalReference,
    postalService: false,
    ...(input.multaPercentual ? { fine: { value: input.multaPercentual } } : {}),
    ...(input.jurosMensalPercentual ? { interest: { value: input.jurosMensalPercentual } } : {}),
  });
  const [qr, linha] = await Promise.all([
    asaas<{ encodedImage?: string; payload?: string; expirationDate?: string }>(rt, "GET", `/payments/${pay.id}/pixQrCode`).catch(() => null),
    asaas<{ identificationField?: string; barCode?: string }>(rt, "GET", `/payments/${pay.id}/identificationField`).catch(() => null),
  ]);
  return {
    id: pay.id,
    status: pay.status,
    invoiceUrl: pay.invoiceUrl ?? null,
    bankSlipUrl: pay.bankSlipUrl ?? null,
    pix: { payload: qr?.payload ?? null, qrBase64: qr?.encodedImage ?? null, expiraEm: qr?.expirationDate ?? null },
    linhaDigitavel: linha?.identificationField ?? null,
  };
}

/** Consulta o pagamento (fallback do webhook – sincronizarPendentes). */
export async function consultarPagamento(rt: AsaasRuntime, paymentId: string): Promise<PagamentoAsaas> {
  return asaas<PagamentoAsaas>(rt, "GET", `/payments/${encodeURIComponent(paymentId)}`);
}

/** Remove (cancela) a cobrança no Asaas. 404 = já removida. */
export async function removerCobranca(rt: AsaasRuntime, paymentId: string): Promise<void> {
  await asaas(rt, "DELETE", `/payments/${encodeURIComponent(paymentId)}`).catch((e) => {
    if (!(e instanceof ErroAsaas && e.status === 404)) throw e;
  });
}

/** Teste de conexão: dados da conta (nome/e-mail) e saldo. */
export async function testarConexao(rt: AsaasRuntime): Promise<{ conta: string; ambiente: "sandbox" | "produção"; saldo: number | null }> {
  const conta = await asaas<{ name?: string; email?: string; companyName?: string }>(rt, "GET", "/myAccount");
  const saldo = await asaas<{ balance?: number }>(rt, "GET", "/finance/balance").catch(() => ({ balance: undefined }));
  return { conta: conta.companyName || conta.name || conta.email || "conta Asaas", ambiente: baseUrlAsaas(rt) === SANDBOX ? "sandbox" : "produção", saldo: typeof saldo.balance === "number" ? saldo.balance : null };
}

/** Registra o webhook de cobranças no Asaas (ignora "já existe"). */
export async function registrarWebhook(rt: AsaasRuntime, input: { url: string; token: string; email: string; nome: string }): Promise<void> {
  await asaas(rt, "POST", "/webhooks", {
    name: input.nome.slice(0, 100),
    url: input.url,
    email: input.email,
    enabled: true,
    interrupted: false,
    authToken: input.token,
    sendType: "SEQUENTIALLY",
    events: ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_RESTORED"],
  }).catch((e) => {
    if (!/already|existe|duplicat/i.test(e instanceof Error ? e.message : "")) throw e;
  });
}
