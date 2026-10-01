import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { lerArquivo } from "@/lib/storage";
import { naoAutenticado, naoEncontrado, proibido, rota } from "@/lib/http";
import { can } from "@/lib/rbac";

// GET /api/v1/admin/exportacoes/{id} – baixa o ZIP quando CONCLUIDA; senão (ou com ?status=1) retorna o status em JSON.
export const GET = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!can(u, "exportar", "exportacao")) throw proibido();
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) throw naoEncontrado();
  // Isolamento: só exportações da organização do usuário (as de outro cliente respondem 404).
  const exp = await prisma.exportacao.findFirst({ where: { id: id.data, organizacao_id: u.organizacao_id ?? "00000000-0000-0000-0000-000000000000" } });
  if (!exp) throw naoEncontrado("Exportação não encontrada.");
  const somenteStatus = new URL(req.url).searchParams.has("status");
  if (somenteStatus || exp.status !== "CONCLUIDA" || !exp.storage_key) {
    return NextResponse.json({ ...exp, storage_key: undefined }, { status: exp.status === "CONCLUIDA" || somenteStatus ? 200 : 202 });
  }
  const buf = await lerArquivo(exp.storage_key);
  await auditar({ usuario_id: u.id, acao: "EXPORTACAO_DOWNLOAD", entidade: "exportacao", entidade_id: exp.id, depois: { tamanho: buf.length } });
  const nome = `licenciagov-exportacao-${exp.created_at.toISOString().slice(0, 10)}-${exp.id.slice(0, 8)}.zip`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(buf.length),
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
