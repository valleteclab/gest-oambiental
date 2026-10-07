import Link from "next/link";
import { forbidden } from "next/navigation";
import { CabecalhoPagina, Card, Paginacao } from "@/components/ui";
import { AbasLogs, FiltrosLogs } from "@/components/ged/logs/filtros-logs";
import { TabelaAcessos, TabelaAlteracoes, TabelaComunicacoes } from "@/components/ged/logs/tabelas";
import { exigirGed } from "@/lib/ged/escopo";
import { listarAcessos, listarAlteracoes, listarComunicacoes, usuariosParaFiltro } from "@/lib/ged/logs/consulta";
import { lerFiltros, paramsDosFiltros } from "@/lib/ged/logs/filtros";
import { podeVerLogs } from "@/lib/ged/papeis";

export const dynamic = "force-dynamic";
export const metadata = { title: "Logs – Gestão de Documentos" };

export default async function PaginaLogs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigirGed();
  if (!podeVerLogs(ctx)) forbidden();
  const f = lerFiltros(await searchParams);
  const usuarios = await usuariosParaFiltro(ctx);
  const pagina =
    f.aba === "acessos" ? await listarAcessos(ctx, f) : f.aba === "alteracoes" ? await listarAlteracoes(ctx, f) : await listarComunicacoes(ctx, f);
  const csv = `/api/v1/ged/logs?${paramsDosFiltros(f, { formato: "csv" })}`;

  return (
    <>
      <CabecalhoPagina
        titulo="Logs"
        subtitulo="Acessos, alterações e comunicações do seu cliente. Os horários são de Brasília."
        acoes={<a href={csv} className="btn-secundario" data-testid="exportar-csv">Exportar CSV (filtro atual)</a>}
      />
      <AbasLogs f={f} />
      <Card>
        <FiltrosLogs f={f} usuarios={usuarios} />
        {f.aba === "acessos" && <TabelaAcessos itens={(pagina as Awaited<ReturnType<typeof listarAcessos>>).itens} />}
        {f.aba === "alteracoes" && <TabelaAlteracoes itens={(pagina as Awaited<ReturnType<typeof listarAlteracoes>>).itens} />}
        {f.aba === "comunicacoes" && <TabelaComunicacoes itens={(pagina as Awaited<ReturnType<typeof listarComunicacoes>>).itens} />}
        <Paginacao page={pagina.page} size={pagina.size} total={pagina.total} href={(p) => `/ged/logs?${paramsDosFiltros(f, { page: p })}`} />
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Os acessos são mantidos pelo prazo definido em <Link href="/ged/admin/configuracoes" prefetch={false} className="underline">Configurações</Link>; as alterações e comunicações não são apagadas.
        Documentos aparecem pelo número (o título não é exibido nos logs).
      </p>
    </>
  );
}
