import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { executarAcaoProtocolo, obterProtocolo, type AnexoEntrada } from "@/lib/ged/protocolo/servico";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/protocolos/{id} → ficha, andamento e anexos (404 se de outro cliente ou sem acesso)
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  return NextResponse.json(await obterProtocolo(ctx, id));
});

// POST /api/v1/ged/protocolos/{id}  { acao: ANALISAR|ENCAMINHAR|RESPONDER|ARQUIVAR|DEVOLVER|INDEFERIR, texto?, destino_setor_id?|destino_usuario_id? }
// (multipart: campo "dados" com o JSON + "arquivo" opcional na resposta). Exige poder agir (403); outro cliente/sem acesso = 404.
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  let dados: unknown;
  let anexo: AnexoEntrada | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) throw invalido("Corpo inválido.");
    try {
      dados = JSON.parse(String(form.get("dados") ?? ""));
    } catch {
      throw invalido('Envie o campo "dados" com o JSON da ação.');
    }
    const f = form.get("arquivo");
    if (f instanceof File && f.size > 0) anexo = { arquivo: Buffer.from(await f.arrayBuffer()), nome_arquivo: f.name, mime: f.type };
  } else {
    dados = await req.json().catch(() => {
      throw invalido("Corpo JSON inválido.");
    });
  }
  return NextResponse.json(await executarAcaoProtocolo(ctx, id, dados, anexo), { status: 201 });
});
