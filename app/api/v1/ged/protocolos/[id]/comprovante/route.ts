import { NextResponse } from "next/server";
import { naoEncontrado, proibido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { cabecalhosArquivo } from "@/lib/ged/documentos/arquivo-http";
import { registrarAcesso } from "@/lib/ged/logs/acesso";
import { carregarProtocolo, emitirComprovanteProtocolo, lerComprovante } from "@/lib/ged/protocolo/servico";
import { podeRegistrarProtocolo } from "@/lib/ged/protocolo/regras";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/protocolos/{id}/comprovante → PDF do comprovante (quem pode ver o protocolo; sempre autenticado, sem cache)
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const { p } = await carregarProtocolo(ctx, id);
  const c = await lerComprovante(ctx, p.id);
  if (!c) throw naoEncontrado("O comprovante deste protocolo ainda não foi emitido.");
  if (p.comprovante_documento_id) await registrarAcesso(ctx, "BAIXAR", { documento_id: p.comprovante_documento_id, versao_id: p.comprovante_versao_id ?? undefined });
  return new Response(new Uint8Array(c.buffer), { headers: cabecalhosArquivo({ mime: "application/pdf", tamanho: c.buffer.length, sha256: c.sha256, tipo: "attachment", nome: c.nome }) });
});

// POST /api/v1/ged/protocolos/{id}/comprovante → emite o comprovante se ainda não existir (idempotente)
export const POST = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const { p, agir } = await carregarProtocolo(ctx, id);
  if (!agir || !podeRegistrarProtocolo(ctx.membro.papel)) throw proibido("Você não pode emitir o comprovante deste protocolo.");
  return NextResponse.json(await emitirComprovanteProtocolo(ctx, p.id), { status: 201 });
});
