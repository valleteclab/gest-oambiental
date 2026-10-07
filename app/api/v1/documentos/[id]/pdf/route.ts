import { getUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nomeArquivoPdf, podeBaixarDocumento } from "@/lib/documentos/acesso";
import { naoAutenticado, naoEncontrado, proibido, rota } from "@/lib/http";
import { lerArquivo } from "@/lib/storage";

const UUID = /^[0-9a-f-]{36}$/i;

/** GET /api/v1/documentos/{id}/pdf[?download=1] – PDF original (imutável) do documento. */
export const GET = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!UUID.test(id)) throw naoEncontrado();
  const d = await prisma.documentoOficial.findUnique({ where: { id } });
  if (!d) throw naoEncontrado();
  const u = await getUsuario();
  if (!(await podeBaixarDocumento(u, d))) throw u ? proibido() : naoAutenticado();
  const pdf = await lerArquivo(d.storage_key);
  const disp = new URL(req.url).searchParams.get("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `${disp}; filename="${nomeArquivoPdf(d.numero)}"`,
      "Cache-Control": "private, no-store",
      "X-Documento-Sha256": d.sha256_pdf,
    },
  });
});
