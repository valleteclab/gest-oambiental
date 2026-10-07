import { NextResponse } from "next/server";
import { z } from "zod";
import { naoEncontrado, rota } from "@/lib/http";
import { pdfTesteDoCertificado } from "@/lib/ged/admin/certificado";
import { ctxGedApi } from "@/lib/ged/escopo";

export const dynamic = "force-dynamic";

// GET → PDF de amostra assinado com o e-CNPJ do cliente (só GED_ADMIN; certificado de outro cliente = 404). Não é documento do GED.
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) throw naoEncontrado("Certificado não encontrado.");
  const pdf = await pdfTesteDoCertificado(ctx, id.data);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="teste-assinatura.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
