import { NextResponse } from "next/server";
import { z } from "zod";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { concluirEnvio } from "@/lib/ged/importacao/envio";
import { iniciarImportacaoAposEnvio } from "@/lib/ged/importacao/servico";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const zCorpo = z.object({
  ignorados: z.array(z.object({ caminho: z.string().max(2000), motivo: z.string().max(300).optional() })).max(5000).optional(),
  ocultos: z.number().int().min(0).optional(),
});

// POST /api/v1/ged/importacoes/{id}/concluir (JSON, opcional) – fecha o envio e coloca o lote na fila (RECEBENDO → PENDENTE).
// Pasta: `ignorados` = arquivos que o navegador não enviou (formato não permitido, ZIP duplicado da pasta irmã…) e `ocultos` = contagem do lixo.
// ZIP em partes: exige todas as partes. Idempotente.
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const texto = await req.text();
  const corpo = zCorpo.safeParse(texto ? JSON.parse(texto) : {});
  if (!corpo.success) throw invalido("Dados de conclusão inválidos.");
  const r = await concluirEnvio(ctx, id, corpo.data);
  const via = await iniciarImportacaoAposEnvio(ctx.organizacao_id, id);
  return NextResponse.json({ ...r, via });
});
