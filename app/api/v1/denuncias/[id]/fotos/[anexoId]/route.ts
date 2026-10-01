import { prisma } from "@/lib/db";
import { naoEncontrado, proibido, rota } from "@/lib/http";
import { lerArquivo } from "@/lib/storage";
import { podeVerMunicipio } from "@/lib/rbac";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";

export const dynamic = "force-dynamic";

// GET /api/v1/denuncias/{id}/fotos/{anexoId} – foto enviada pelo cidadão (canal de atendimento), com escopo no município
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string; anexoId: string }> }) => {
  const u = await usuarioApi("denuncia");
  const { id, anexoId } = await params;
  if (!ehUuid(id) || !ehUuid(anexoId)) throw naoEncontrado();
  const a = await prisma.anexo.findFirst({ where: { id: anexoId, denuncia_id: id }, include: { denuncia: { select: { municipio_id: true } } } });
  if (!a || !a.denuncia) throw naoEncontrado("Foto não encontrada.");
  if (!podeVerMunicipio(u, a.denuncia.municipio_id)) throw proibido();
  const dados = await lerArquivo(a.storage_key);
  return new Response(new Uint8Array(dados), { headers: { "Content-Type": a.mime, "Content-Length": String(dados.length), "Cache-Control": "private, max-age=3600", ETag: `"${a.sha256}"` } });
});
