import { getUsuario } from "@/lib/auth";
import { naoAutenticado, rota } from "@/lib/http";
import { lerArquivo } from "@/lib/storage";
import { obterAnexoAutorizado } from "@/lib/processo/anexos";

/** GET /api/v1/anexos/{id} – download com checagem de escopo (processo: município/titularidade; fiscalização: município). */
export const GET = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const a = await obterAnexoAutorizado(id, u);
  const dados = await lerArquivo(a.storage_key);
  const inline = new URL(req.url).searchParams.get("inline") === "1" && /^(application\/pdf|image\/(png|jpeg))$/.test(a.mime);
  const nome = encodeURIComponent(a.nome_arquivo);
  return new Response(new Uint8Array(dados), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(dados.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${nome}`,
      "X-Content-SHA256": a.sha256,
      "Cache-Control": "private, no-store",
    },
  });
});
