// Pré-visualização do PDF pela rota autenticada (mesma origem, sem URL pré-assinada). Sempre oferece abrir/baixar:
// celulares e alguns navegadores não embutem PDF.
import Link from "next/link";

export function PreviewPdf({ documentoId, versaoId, titulo }: { documentoId: string; versaoId?: string | null; titulo: string }) {
  const base = `/api/v1/ged/documentos/${documentoId}/arquivo`;
  const q = versaoId ? `versao=${versaoId}&` : "";
  const inline = `${base}?${q}inline=1`;
  const baixar = `${base}?${versaoId ? `versao=${versaoId}` : ""}`;
  return (
    <div data-testid="preview-pdf">
      <object data={inline} type="application/pdf" aria-label={`Visualização do PDF: ${titulo}`} className="h-[70vh] min-h-[360px] w-full rounded-md border border-slate-200 bg-slate-100">
        <p className="p-4 text-sm text-slate-700">Seu navegador não exibe PDF embutido. Use os links abaixo para abrir ou baixar o arquivo.</p>
      </object>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={inline} target="_blank" rel="noopener" className="btn-secundario btn-sm">Abrir em nova aba</a>
        <Link href={baixar} prefetch={false} className="btn-secundario btn-sm" download>Baixar PDF</Link>
      </div>
    </div>
  );
}
