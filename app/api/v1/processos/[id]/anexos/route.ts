import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { invalido, naoAutenticado, rota } from "@/lib/http";
import { anexarArquivo, prepararUpload } from "@/lib/processo/anexos";
import { obterProcessoAutorizado } from "@/lib/processo/consultas";

/** GET /api/v1/processos/{id}/anexos – lista (metadados). */
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const p = await obterProcessoAutorizado(id, u);
  const itens = await prisma.anexo.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" } });
  return NextResponse.json({ items: itens.map(({ storage_key: _k, ...a }) => ({ ...a, url: `/api/v1/anexos/${a.id}` })) });
});

const PedidoPreAssinado = z.object({ nome: z.string().min(1).max(200), mime: z.string().max(100).optional().nullable(), tamanho: z.number().int().min(1) });

/**
 * POST /api/v1/processos/{id}/anexos
 *  - multipart/form-data (arquivo, tipo, documento_exigido_id?, pendencia_id?) → grava e retorna o anexo (201);
 *  - JSON {nome, mime, tamanho, tipo, ...} → STORAGE_DRIVER=s3: {modo:"s3", url, storage_key} (PUT direto e depois
 *    POST /anexos/confirmar); em modo local: {modo:"multipart"}.
 */
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const tipoConteudo = req.headers.get("content-type") ?? "";
  if (tipoConteudo.includes("multipart/form-data")) {
    const form = await req.formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) throw invalido("Envie o arquivo no campo 'arquivo'.");
    const a = await anexarArquivo(
      id,
      { nome: arquivo.name, mime: arquivo.type, dados: Buffer.from(await arquivo.arrayBuffer()) },
      { tipo: form.get("tipo") ?? undefined, documento_exigido_id: form.get("documento_exigido_id") ?? undefined, pendencia_id: form.get("pendencia_id") ?? undefined },
      u,
    );
    const { storage_key: _k, ...resto } = a;
    return NextResponse.json({ ...resto, url: `/api/v1/anexos/${a.id}` }, { status: 201 });
  }
  const corpo = await req.json();
  const info = PedidoPreAssinado.parse(corpo);
  return NextResponse.json(await prepararUpload(id, info, corpo, u));
});
