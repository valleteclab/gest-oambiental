import { NextResponse } from "next/server";
import { naoEncontrado, rota } from "@/lib/http";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";
import { StatusDenunciaSchema } from "@/lib/fiscalizacao/schemas";
import { alterarStatusDenuncia, obterDenuncia } from "@/lib/fiscalizacao/servico";

type Ctx = { params: Promise<{ id: string }> };

export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const u = await usuarioApi("denuncia");
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  return NextResponse.json(await obterDenuncia(u, id));
});

// PATCH /api/v1/denuncias/{id} {status, despacho}
export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const u = await usuarioApi("denuncia");
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const d = StatusDenunciaSchema.parse(await req.json());
  const r = await alterarStatusDenuncia(u, id, d.status, d.despacho);
  return NextResponse.json({ id: r.id, status: r.status });
});
