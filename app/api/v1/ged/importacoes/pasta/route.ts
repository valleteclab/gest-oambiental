import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { iniciarImportacaoPasta } from "@/lib/ged/importacao/envio";

export const dynamic = "force-dynamic";

const zCorpo = z.object({
  nome: z.string().max(300).optional().nullable(),
  total_esperado: z.number().int().min(0).max(1_000_000).optional().nullable(),
  pasta_id: z.string().optional().nullable(),
  tipo_id: z.string().optional().nullable(),
  sensibilidade: z.string().optional().nullable(),
  unir_pastas: z.boolean().optional(),
});

// POST /api/v1/ged/importacoes/pasta (JSON) – abre um lote RECEBENDO para enviar uma pasta arquivo a arquivo.
// Depois: POST …/{id}/arquivos (um por arquivo), GET …/{id}/recebidos (retomada) e POST …/{id}/concluir.
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = zCorpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) throw invalido("Dados do lote inválidos.");
  const r = await iniciarImportacaoPasta(ctx, corpo.data);
  return NextResponse.json(r, { status: 201 });
});
