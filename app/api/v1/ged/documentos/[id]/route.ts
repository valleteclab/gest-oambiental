import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { atualizarMetadadosDocumento } from "@/lib/ged/documentos/servico";
import { marcadoresDoDocumento } from "@/lib/ged/marcadores";
import { exigirDocumento } from "@/lib/ged/permissoes";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/ged/documentos/:id – metadados, versões e ações do usuário (404 se outro cliente/sem VER)
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const { doc, acoes } = await exigirDocumento(ctx, id, "VER");
  const [d, versoes, marcadores] = await Promise.all([
    ctx.db.gedDocumento.findUnique({
      where: { id: doc.id },
      select: { id: true, numero: true, titulo: true, status: true, sensibilidade: true, remetente: true, data_documento: true, pasta_id: true, tipo_id: true, versao_atual_id: true, contem_dados_pessoais: true, anonimizacao_status: true, created_at: true, updated_at: true },
    }),
    ctx.db.gedVersaoDocumento.findMany({ where: { documento_id: doc.id }, orderBy: { n: "desc" }, select: { id: true, n: true, origem: true, nome_arquivo: true, mime: true, tamanho: true, sha256: true, paginas: true, texto_status: true, ocr_status: true, selada: true, created_at: true } }),
    marcadoresDoDocumento(ctx, doc.id),
  ]);
  return NextResponse.json({ ...d, versoes, marcadores, acoes });
});

// PATCH /api/v1/ged/documentos/:id – { titulo?, tipo_id?, remetente?, data_documento?, pasta_id?, sensibilidade? }
export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  await atualizarMetadadosDocumento(ctx, id, corpo);
  return NextResponse.json({ ok: true });
});
