import { prisma } from "@/lib/db";
import { naoEncontrado, proibido, rota } from "@/lib/http";
import { lerArquivo } from "@/lib/storage";
import { podeVerMunicipio } from "@/lib/rbac";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";

// GET /api/v1/fiscalizacoes/{id}/fotos/{anexoId} – imagem servida somente a usuários com escopo no município
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string; anexoId: string }> }) => {
  const u = await usuarioApi();
  const { id, anexoId } = await params;
  if (!ehUuid(id) || !ehUuid(anexoId)) throw naoEncontrado();
  const a = await prisma.anexo.findFirst({ where: { id: anexoId, fiscalizacao_id: id }, include: { fiscalizacao: { select: { municipio_id: true } } } });
  if (!a || !a.fiscalizacao) throw naoEncontrado("Foto não encontrada.");
  if (!podeVerMunicipio(u, a.fiscalizacao.municipio_id)) throw proibido();
  const dados = await lerArquivo(a.storage_key);
  return new Response(new Uint8Array(dados), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(dados.length),
      "Content-Disposition": `inline; filename="${a.nome_arquivo.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
      ETag: `"${a.sha256}"`,
    },
  });
});
