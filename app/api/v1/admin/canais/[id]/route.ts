import { NextResponse } from "next/server";
import { z } from "zod";
import { naoAutenticado, naoEncontrado, proibido, rota } from "@/lib/http";
import { getUsuario } from "@/lib/auth";
import { podeConfigurar } from "@/lib/admin/guard";
import { ehUuid } from "@/lib/fiscalizacao/api";
import { atualizarCanal, conectarCanal, statusCanal, testarCanal } from "@/lib/agente/canais-admin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function admin() {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!podeConfigurar(u)) throw proibido();
  return u;
}

const Patch = z.object({
  nome: z.string().trim().min(3).max(120).optional(),
  ativo: z.boolean().optional(),
  municipio_id: z.string().uuid().nullable().optional(),
  publicos: z.record(z.string(), z.string().max(500)).optional(),
  segredos: z.record(z.string(), z.string().max(2000)).optional(),
});

// PATCH /api/v1/admin/canais/{id}
export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const u = await admin();
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const c = await atualizarCanal(u, id, Patch.parse(await req.json()));
  return NextResponse.json({ id: c.id, ativo: c.ativo });
});

const Acao = z.discriminatedUnion("acao", [z.object({ acao: z.literal("conectar") }), z.object({ acao: z.literal("status") }), z.object({ acao: z.literal("testar"), destino: z.string().trim().min(3).max(150) })]);

// POST /api/v1/admin/canais/{id} {acao: conectar|status|testar}
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const u = await admin();
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const a = Acao.parse(await req.json());
  if (a.acao === "conectar") return NextResponse.json(await conectarCanal(u, id));
  if (a.acao === "status") return NextResponse.json(await statusCanal(u, id));
  return NextResponse.json(await testarCanal(u, id, a.destino));
});
