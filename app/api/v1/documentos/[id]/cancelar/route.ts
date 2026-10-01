import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { cancelarDocumento } from "@/lib/documentos";
import { naoAutenticado, rota } from "@/lib/http";

const Corpo = z.object({ motivo: z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres)."), substituto_id: z.string().uuid().optional() });

/** POST /api/v1/documentos/{id}/cancelar {motivo, substituto_id?} */
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const c = Corpo.parse(await req.json());
  const doc = await cancelarDocumento(id, c.motivo, u, c.substituto_id);
  return NextResponse.json(doc);
});
