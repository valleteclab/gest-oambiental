import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { naoAutenticado, rota } from "@/lib/http";
import { salvarChecklist } from "@/lib/processo/checklist";
import { obterProcessoAutorizado } from "@/lib/processo/consultas";
import { itensChecklistPendentes, lerItensChecklist } from "@/lib/processo/maquina";

/** GET /api/v1/processos/{id}/checklist – itens do modelo + respostas + obrigatórios pendentes. */
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const p = await obterProcessoAutorizado((await params).id, u);
  const modelo = p.tipo_ato.checklist_modelo;
  const itens = lerItensChecklist(modelo?.itens);
  const preenchido = modelo ? await prisma.checklistPreenchido.findFirst({ where: { processo_id: p.id, checklist_modelo_id: modelo.id } }) : null;
  const respostas = (preenchido?.respostas as Record<string, unknown>) ?? {};
  return NextResponse.json({ modelo: modelo ? { id: modelo.id, nome: modelo.nome } : null, itens, respostas, pendentes: itensChecklistPendentes(itens, respostas).map((i) => i.id) });
});

/** PUT /api/v1/processos/{id}/checklist – {respostas: {itemId: valor}} */
export const PUT = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { respostas } = z.object({ respostas: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) }).parse(await req.json());
  const r = await salvarChecklist((await params).id, respostas, u);
  return NextResponse.json({ id: r.id, respostas: r.respostas });
});
