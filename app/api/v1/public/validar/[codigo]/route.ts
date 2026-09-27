import { NextResponse } from "next/server";
import { documentoPorCodigo } from "@/lib/documentos/publico";
import { naoEncontrado, rota } from "@/lib/http";

/** GET /api/v1/public/validar/{codigo} – autenticidade de documento oficial (dados mascarados). */
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ codigo: string }> }) => {
  const { codigo } = await params;
  const d = await documentoPorCodigo(decodeURIComponent(codigo));
  if (!d) throw naoEncontrado("Nenhum documento encontrado com este código verificador.");
  const { id, pdf_publico, ...resto } = d;
  return NextResponse.json({ ...resto, url_pdf: pdf_publico ? `/api/v1/documentos/${id}/pdf` : null }, { headers: { "Cache-Control": "no-store" } });
});
