import { getUsuario } from "@/lib/auth";
import { naoAutenticado, naoEncontrado, proibido, rota } from "@/lib/http";
import { lerArquivo } from "@/lib/storage";
import { auditar } from "@/lib/audit";
import { obterCobrancaAutorizada, podeVerCobrancas } from "@/lib/cobranca/servico";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

/** GET /api/v1/cobrancas/{id}/comprovante – comprovante da baixa manual (somente servidores do município). */
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const c = await obterCobrancaAutorizada(id, u);
  if (!podeVerCobrancas(u, c.municipio_id)) throw proibido();
  if (!c.comprovante_key) throw naoEncontrado("Cobrança sem comprovante.");
  const dados = await lerArquivo(c.comprovante_key);
  await auditar({ usuario_id: u.id, acao: "DOWNLOAD", entidade: "cobranca_comprovante", entidade_id: c.id });
  const nome = c.comprovante_key.split("/").pop() ?? "comprovante";
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(dados), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" } });
});
