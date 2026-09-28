import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario, contextoRequisicao } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { naoAutenticado, paginacao, proibido, rota } from "@/lib/http";
import { can, UUID_NENHUM } from "@/lib/rbac";
import { solicitarExportacao } from "@/lib/export/exportar";

// GET /api/v1/admin/exportacoes – lista (ADMIN / SEMA_INEMA)
export const GET = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!can(u, "ver", "exportacao")) throw proibido();
  const { page, size, skip, take } = paginacao(new URL(req.url));
  const [data, total] = await Promise.all([
    prisma.exportacao.findMany({ where: { organizacao_id: u.organizacao_id ?? UUID_NENHUM }, orderBy: { created_at: "desc" }, skip, take }),
    prisma.exportacao.count({ where: { organizacao_id: u.organizacao_id ?? UUID_NENHUM } }),
  ]);
  return NextResponse.json({ data: data.map((x) => ({ ...x, storage_key: undefined, download: x.status === "CONCLUIDA" ? `/api/v1/admin/exportacoes/${x.id}` : null })), page, size, total });
});

// POST /api/v1/admin/exportacoes – solicita exportação completa (ZIP CSV+JSON por tabela, anexos, manifest)
export const POST = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!can(u, "exportar", "exportacao")) throw proibido("Somente ADMIN e SEMA/INEMA podem exportar a base completa.");
  const body = z.object({ escopo: z.literal("COMPLETA").default("COMPLETA") }).parse(await req.json().catch(() => ({})));
  const exp = await solicitarExportacao(u, body.escopo, await contextoRequisicao());
  return NextResponse.json({ id: exp.id, status: exp.status, processamento: exp.via, url: `/api/v1/admin/exportacoes/${exp.id}` }, { status: 202 });
});
