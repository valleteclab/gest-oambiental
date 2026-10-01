import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { carregarCanal, provedor } from "@/lib/canais";
import { receberEvento } from "@/lib/agente/ingestao";
import type { SendgridConvertido } from "@/lib/canais/email";
import { ehUuid } from "@/lib/fiscalizacao/api";

// POST /api/webhooks/{canalId} – um endpoint por canal (Evolution, Z-API, Chatwoot, e-mail inbound).
// 1) segredo verificado conforme o provedor (401 se inválido); 2) evento bruto gravado em evento_webhook;
// 3) responde 200 imediatamente – o processamento vai para a fila (worker) ou segundo plano (sem worker).
export const dynamic = "force-dynamic";
const LIMITE = 25 * 1024 * 1024;

const nega = (status: number, message: string) => NextResponse.json({ code: status === 401 ? "NAO_AUTORIZADO" : "INVALIDO", message }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ canalId: string }> }) {
  const { canalId } = await params;
  if (!ehUuid(canalId)) return nega(404, "Canal não encontrado.");
  if (Number(req.headers.get("content-length") ?? 0) > LIMITE) return nega(413, "Conteúdo muito grande.");
  const canal = await carregarCanal(canalId).catch(() => null);
  if (!canal || canal.tipo === "WEBCHAT") return nega(404, "Canal não encontrado.");
  const ct = req.headers.get("content-type");
  let corpo: string;
  const url = new URL(req.url);
  if (canal.tipo === "EMAIL" && (ct ?? "").includes("multipart/form-data")) {
    // SendGrid Inbound Parse → JSON normalizado (anexos em base64)
    const f = await req.formData();
    const conv: SendgridConvertido = { formato: "sendgrid", campos: {}, anexos: [] };
    for (const [k, v] of f.entries()) {
      if (typeof v === "string") conv.campos[k] = v.slice(0, 200_000);
      else if (v.size > 0 && conv.anexos.length < 5) conv.anexos.push({ nome: v.name, mime: v.type || "application/octet-stream", base64: Buffer.from(await v.arrayBuffer()).toString("base64") });
    }
    corpo = JSON.stringify(conv);
  } else {
    corpo = await req.text();
    if (corpo.length > LIMITE) return nega(413, "Conteúdo muito grande.");
  }
  if (!provedor(canal.tipo).verifyWebhook({ headers: req.headers, url, corpo }, canal)) {
    console.warn(`[webhook] assinatura/segredo inválido no canal ${canalId}`);
    return nega(401, "Segredo do webhook inválido.");
  }
  const ativo = await prisma.canalAtendimento.findUnique({ where: { id: canalId }, select: { ativo: true } });
  if (!ativo?.ativo) return NextResponse.json({ ok: true, ignorado: "canal inativo" });
  try {
    JSON.parse(corpo);
  } catch {
    return nega(422, "JSON inválido.");
  }
  const r = await receberEvento(canalId, corpo, ct);
  return NextResponse.json({ ok: true, evento: r.id });
}
