import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { iniciarImportacaoZipPartes } from "@/lib/ged/importacao/envio";

export const dynamic = "force-dynamic";

const zCorpo = z.object({
  nome_arquivo: z.string().min(1).max(300),
  tamanho: z.number().int().min(22),
  pasta_id: z.string().optional().nullable(),
  tipo_id: z.string().optional().nullable(),
  sensibilidade: z.string().optional().nullable(),
  unir_pastas: z.boolean().optional(),
});

// POST /api/v1/ged/importacoes/zip-partes (JSON) – inicia o envio de um ZIP grande em partes de ~8 MB.
// Depois: PUT …/{id}/partes/{n} (n = 1…partes_total), GET …/{id}/recebidos (retomada) e POST …/{id}/concluir.
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = zCorpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) throw invalido("Dados do ZIP inválidos.");
  const r = await iniciarImportacaoZipPartes(ctx, corpo.data);
  return NextResponse.json(r, { status: 201 });
});
