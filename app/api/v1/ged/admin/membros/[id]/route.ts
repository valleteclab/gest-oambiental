import { NextResponse } from "next/server";
import { z } from "zod";
import { naoEncontrado, rota } from "@/lib/http";
import { alterarPapelMembro, definirMembroAtivo, definirSetoresDoMembro, redefinirSenhaMembro } from "@/lib/ged/admin/membros";
import { ctxGedApi } from "@/lib/ged/escopo";
import { zPapelGed, zUuid } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

const Corpo = z.object({
  papel: zPapelGed.optional(),
  ativo: z.boolean().optional(),
  setor_ids: z.array(zUuid).max(30).optional(),
  redefinir_senha: z.literal(true).optional(),
});

// PATCH {papel?, ativo?, setor_ids?, redefinir_senha?} – regra do último administrador; só GED_ADMIN; outro cliente = 404
export const PATCH = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const id = zUuid.safeParse((await params).id);
  if (!id.success) throw naoEncontrado("Membro não encontrado.");
  const c = Corpo.parse(await req.json());
  if (c.papel) await alterarPapelMembro(ctx, id.data, c.papel);
  if (c.ativo !== undefined) await definirMembroAtivo(ctx, id.data, c.ativo);
  if (c.setor_ids) await definirSetoresDoMembro(ctx, id.data, c.setor_ids);
  const senha = c.redefinir_senha ? await redefinirSenhaMembro(ctx, id.data) : null;
  return NextResponse.json({ ok: true, senha_temporaria: senha }, { headers: NO_STORE });
});
