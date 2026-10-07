import { ErroApi, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { naoEncontrado } from "@/lib/ged/db";
import { cabecalhosArquivo } from "@/lib/ged/documentos/arquivo-http";
import { registrarAcessoSeguro, registrarNegado } from "@/lib/ged/documentos/acesso";
import { exigirDocumento } from "@/lib/ged/permissoes";
import { lerArquivoGed } from "@/lib/ged/storage";

export const dynamic = "force-dynamic";
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/v1/ged/documentos/:id/arquivo?versao=<id>&inline=1 – única porta de saída dos arquivos do GED.
// O cliente nunca informa storage_key: a versão é resolvida por ctx.db (escopo do cliente) dentro do documento autorizado.
export const GET = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  let doc;
  try {
    ({ doc } = await exigirDocumento(ctx, id, "VER"));
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) {
      // Só registra o id se o documento existe NESTE cliente (sem VER); id de outro cliente/inexistente nunca é gravado.
      const noTenant = RE_UUID.test(id) ? !!(await ctx.db.gedDocumento.findUnique({ where: { id }, select: { id: true } })) : false;
      await registrarNegado(ctx, id, noTenant);
    }
    throw e;
  }
  const url = new URL(req.url);
  const versaoParam = url.searchParams.get("versao");
  if (versaoParam && !RE_UUID.test(versaoParam)) throw naoEncontrado("Versão não encontrada.");
  const versaoId = versaoParam ?? (await ctx.db.gedDocumento.findUnique({ where: { id: doc.id }, select: { versao_atual_id: true } }))?.versao_atual_id;
  if (!versaoId) throw naoEncontrado("O documento ainda não tem arquivo.");
  const v = await ctx.db.gedVersaoDocumento.findFirst({ where: { id: versaoId, documento_id: doc.id }, select: { id: true, storage_key: true, mime: true, nome_arquivo: true, sha256: true } });
  if (!v) throw naoEncontrado("Versão não encontrada.");
  let dados: Buffer;
  try {
    dados = await lerArquivoGed(ctx.organizacao_id, v.storage_key);
  } catch (e) {
    console.error("[ged] arquivo ilegível", v.id, e instanceof Error ? e.message : e);
    throw naoEncontrado("Arquivo não encontrado no armazenamento.");
  }
  const inline = url.searchParams.get("inline") === "1";
  await registrarAcessoSeguro(ctx, inline ? "VISUALIZAR" : "BAIXAR", { documento_id: doc.id, versao_id: v.id });
  return new Response(new Uint8Array(dados), { headers: cabecalhosArquivo({ mime: v.mime, tamanho: dados.length, sha256: v.sha256, tipo: inline ? "inline" : "attachment", nome: v.nome_arquivo }) });
});
