import { getUsuario } from "@/lib/auth";
import { naoAutenticado, proibido, rota } from "@/lib/http";
import { can } from "@/lib/rbac";
import { certificadoDoEscopo, pdfTesteAssinado, podeTerCertificadoProprio } from "@/lib/assinatura/servico";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/certificados/{id}/teste – PDF de AMOSTRA assinado com o certificado (sem valor legal), para conferir no
 * Adobe Reader / validar.iti.gov.br. ADMIN: certificados da sua organização; servidor: somente o próprio e-CPF.
 */
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id } = await params;
  const admin = can(u, "configurar", "admin");
  if (!admin && !podeTerCertificadoProprio(u)) throw proibido();
  const c = await certificadoDoEscopo(u, id, { proprio: !admin });
  if (!c.ativo) throw proibido("Certificado desativado.");
  const pdf = await pdfTesteAssinado(u, c);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="teste-assinatura-${c.thumbprint_sha1.slice(0, 8).toLowerCase()}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
