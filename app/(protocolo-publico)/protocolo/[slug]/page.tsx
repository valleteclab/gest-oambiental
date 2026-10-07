import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { FormPortalProtocolo } from "@/components/protocolo/form-portal";
import { carregarPortalCache } from "@/lib/ged/protocolo/publico";
import { TEXTO_LGPD_PORTAL } from "@/lib/ged/protocolo/regras";

export const dynamic = "force-dynamic";

export default async function PaginaPortalProtocolo({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const portal = await carregarPortalCache(slug);
  if (!portal) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Protocolar documentos</h1>
        <p className="mt-1 text-sm text-slate-600">Envie documentos ao órgão sem precisar ir ao balcão. Você recebe um comprovante em PDF e um número para acompanhar o andamento.</p>
      </div>
      {portal.orientacao && (
        <Card titulo="Orientações">
          <p className="whitespace-pre-wrap text-sm text-slate-700" data-testid="portal-orientacao">{portal.orientacao}</p>
        </Card>
      )}
      <Card titulo="Dados do protocolo">
        <FormPortalProtocolo slug={slug} assuntos={portal.assuntos} limites={portal.limites} textoLgpd={TEXTO_LGPD_PORTAL} />
      </Card>
    </div>
  );
}
