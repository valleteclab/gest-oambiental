import { NextResponse } from "next/server";
import { invalido, naoEncontrado, rota } from "@/lib/http";
import { metaDosCabecalhos } from "@/lib/ged/assinaturas/limites";
import { assinar } from "@/lib/ged/assinaturas/servico";
import { ctxGedApi } from "@/lib/ged/escopo";
import { zUuid } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";

// POST /api/v1/ged/assinaturas/:id/assinar  { senha, consentimento: true }  (re-autenticação pela senha do próprio signatário; 401 senha incorreta, 429 muitas tentativas, 409 fora da vez/hash divergente)
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await ctxGedApi();
  const id = zUuid.safeParse((await params).id);
  if (!id.success) throw naoEncontrado("Solicitação não encontrada.");
  const corpo = await req.json().catch(() => { throw invalido("Corpo JSON inválido."); });
  const r = await assinar(ctx, { ...corpo, solicitacao_id: id.data }, metaDosCabecalhos(req.headers));
  return NextResponse.json({ ...r, selo: r.selo ? { codigo_verificador: r.selo.codigo_verificador, sha256_final: r.selo.sha256_final, com_certificado: r.selo.com_certificado } : null });
});
