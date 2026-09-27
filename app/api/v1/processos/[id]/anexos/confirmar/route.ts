import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, rota } from "@/lib/http";
import { confirmarUpload } from "@/lib/processo/anexos";

const Corpo = z.object({ storage_key: z.string().min(1).max(500), nome: z.string().min(1).max(200), mime: z.string().max(100).optional().nullable() });

/** POST /api/v1/processos/{id}/anexos/confirmar – após PUT na URL pré-assinada (S3): registra o anexo com SHA-256. */
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const corpo = await req.json();
  const a = await confirmarUpload(id, Corpo.parse(corpo), corpo, u);
  const { storage_key: _k, ...resto } = a;
  return NextResponse.json({ ...resto, url: `/api/v1/anexos/${a.id}` }, { status: 201 });
});
