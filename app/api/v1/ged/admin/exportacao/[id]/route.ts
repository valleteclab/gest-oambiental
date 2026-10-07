import { NextResponse } from "next/server";
import { z } from "zod";
import { naoEncontrado, rota } from "@/lib/http";
import { baixarExportacao } from "@/lib/ged/admin/exportacao";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";

// GET → ZIP da exportação CONCLUÍDA (somente da própria organização; de outro cliente = 404). Auditado.
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) throw naoEncontrado("Exportação não encontrada.");
  const { nome, dados } = await baixarExportacao(ctx, id.data);
  return new NextResponse(new Uint8Array(dados), {
    headers: { "Content-Type": "application/zip", "Content-Length": String(dados.length), "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
