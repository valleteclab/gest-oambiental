import { NextResponse } from "next/server";
import { processarWebhookAsaas } from "@/lib/cobranca/servico";

// POST /api/v1/webhooks/asaas/{token} – eventos de pagamento do Asaas (conta da prefeitura). PÚBLICO (sem sessão):
// autentica pelo token do município na URL + header `asaas-access-token` (lib/cobranca/servico processarWebhookAsaas).
// SEMPRE responde 200 – inclusive para token inválido ou erro interno – para o Asaas não pausar a fila de
// reentregas; o motivo fica no log do servidor e o evento bruto no log de auditoria (WEBHOOK_ASAAS).
export const dynamic = "force-dynamic";
const LIMITE = 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const texto = await req.text();
    if (texto.length > LIMITE) {
      console.warn("[webhook asaas] corpo muito grande – ignorado");
      return NextResponse.json({ received: true });
    }
    let corpo: unknown = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      console.warn("[webhook asaas] JSON inválido – ignorado");
      return NextResponse.json({ received: true });
    }
    const r = await processarWebhookAsaas(token, req.headers.get("asaas-access-token"), corpo);
    if (!r.processado) console.info(`[webhook asaas] ${r.motivo}${r.cobranca_id ? ` (cobrança ${r.cobranca_id})` : ""}`);
  } catch (e) {
    console.error("[webhook asaas]", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
