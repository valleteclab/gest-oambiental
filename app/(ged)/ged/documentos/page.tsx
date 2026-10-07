import Link from "next/link";
import { CabecalhoPagina, Paginacao } from "@/components/ui";
import { FiltrosDocumentosForm } from "@/components/ged/filtros-documentos";
import { ListaDocumentos } from "@/components/ged/lista-documentos";
import { exigirGed } from "@/lib/ged/escopo";
import { filtrosParaQuery, lerFiltros } from "@/lib/ged/documentos/filtros";
import { listarDocumentos } from "@/lib/ged/documentos/listar";
import { listarMarcadores } from "@/lib/ged/marcadores";
import { podeCriarDocumento } from "@/lib/ged/papeis";
import { listarPastas } from "@/lib/ged/pastas";
import { listarTiposDocumento } from "@/lib/ged/tipos-documento";
import { Aviso } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documentos – Gestão de Documentos" };

export default async function PaginaDocumentos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigirGed();
  const f = lerFiltros(await searchParams);
  const [r, tipos, pastas, marcadores] = await Promise.all([listarDocumentos(ctx, f), listarTiposDocumento(ctx), listarPastas(ctx), listarMarcadores(ctx)]);
  const href = (p: number) => `/ged/documentos${filtrosParaQuery(f, { page: p })}`;
  return (
    <>
      <CabecalhoPagina
        titulo="Documentos"
        subtitulo="Busque por título, remetente, data, tipo, pasta, marcador ou pelo texto dentro dos arquivos."
        acoes={podeCriarDocumento(ctx) ? <Link href="/ged/documentos/novo" prefetch={false} className="btn-primario">Novo documento</Link> : undefined}
      />
      <FiltrosDocumentosForm filtros={f} tipos={tipos} pastas={pastas} marcadores={marcadores} />
      {r.truncado && <div className="mb-3"><Aviso tipo="alerta">A busca no conteúdo encontrou muitos resultados e mostra os mais relevantes. Refine os termos ou use os filtros.</Aviso></div>}
      <p className="mb-2 text-sm text-slate-600" aria-live="polite" data-testid="total-documentos">{r.total} documento(s) encontrado(s)</p>
      <ListaDocumentos linhas={r.linhas} comBusca={!!f.q} />
      <Paginacao page={r.page} size={r.size} total={r.total} href={href} />
    </>
  );
}
