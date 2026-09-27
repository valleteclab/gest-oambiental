import { NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { urlValidacao } from "@/lib/documentos";
import { naoAutenticado, naoEncontrado, proibido, rota } from "@/lib/http";
import { can, isInterno } from "@/lib/rbac";

const UUID = /^[0-9a-f-]{36}$/i;

export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!UUID.test(id)) throw naoEncontrado();
  const d = await prisma.documentoOficial.findUnique({ where: { id } });
  if (!d) throw naoEncontrado();
  if (!isInterno(u) || !can(u, "ver", "documento", d.municipio_id)) throw proibido();
  return NextResponse.json({ ...d, url_validacao: urlValidacao(d.codigo_verificador), url_pdf: `/api/v1/documentos/${d.id}/pdf` });
});
