import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ABAS_PAINEL, painelAssinaturas, type AbaPainel } from "@/lib/ged/assinaturas/consultas";
import { solicitarAssinatura } from "@/lib/ged/assinaturas/servico";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/assinaturas?aba=aguardando|enviadas|concluidas|recusadas&q=&status=&page=&size=  → { linhas, total, page, size }
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const q = new URL(req.url).searchParams;
  const aba = (q.get("aba") ?? "aguardando") as AbaPainel;
  if (!ABAS_PAINEL.includes(aba)) throw invalido("Aba inválida.");
  const status = q.get("status");
  const r = await painelAssinaturas(ctx, {
    aba,
    q: q.get("q") ?? undefined,
    page: Number(q.get("page")) || 1,
    size: Number(q.get("size")) || 15,
    status: status && ["ABERTA", "CONCLUIDA", "RECUSADA", "EXPIRADA", "CANCELADA"].includes(status) ? (status as never) : undefined,
  });
  return NextResponse.json(r);
});

// POST /api/v1/ged/assinaturas  { documento_id, signatarios: [usuario_id…] (na ordem), modo: "SEQUENCIAL"|"PARALELO", prazo_dias?, mensagem? }
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json().catch(() => { throw invalido("Corpo JSON inválido."); });
  return NextResponse.json(await solicitarAssinatura(ctx, corpo), { status: 201 });
});
