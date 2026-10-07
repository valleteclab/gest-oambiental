import { NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, rota } from "@/lib/http";
import { cobrancaParaApi } from "@/lib/cobranca/consultas";
import { obterCobrancaAutorizada } from "@/lib/cobranca/servico";

export const dynamic = "force-dynamic";

/** GET /api/v1/cobrancas/{id} – detalhe (inclui Pix copia e cola, QR base64, linha digitável, fatura). */
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const c = await obterCobrancaAutorizada(id, u);
  const { processo, ...resto } = c;
  return NextResponse.json({ ...cobrancaParaApi(resto), processo: processo ? { id: processo.id, numero: processo.numero } : null });
});
