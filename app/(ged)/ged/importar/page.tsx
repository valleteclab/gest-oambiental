import Link from "next/link";
import { forbidden } from "next/navigation";
import { Aviso, CabecalhoPagina, Card, Paginacao } from "@/components/ui";
import { AutoAtualizar } from "@/components/ged/auto-atualizar";
import { ImportarEnvio } from "@/components/ged/importar-envio";
import { fmtDataHora } from "@/lib/format";
import { exigirGed } from "@/lib/ged/escopo";
import { listarImportacoes } from "@/lib/ged/importacao/servico";
import { EM_ANDAMENTO, StatusImportacao } from "@/components/ged/status-importacao";
import { podeImportarGed } from "@/lib/ged/papeis";
import { pastasParaSeletor } from "@/lib/ged/pastas";
import { listarTiposDocumento } from "@/lib/ged/tipos-documento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importar pasta ou ZIP – Gestão de Documentos" };

export default async function PaginaImportar({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await exigirGed();
  if (!podeImportarGed(ctx)) forbidden();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [tipos, pastas, lotes] = await Promise.all([listarTiposDocumento(ctx), pastasParaSeletor(ctx), listarImportacoes(ctx, { page, size: 10 })]);
  const ativo = lotes.linhas.some((l) => EM_ANDAMENTO.includes(l.status));
  return (
    <>
      <AutoAtualizar ativo={ativo} />
      <CabecalhoPagina titulo="Importar pasta ou ZIP" subtitulo="Envie uma pasta (ou um ZIP) com PDFs organizados em subpastas: a estrutura de pastas vira a árvore de pastas da Gestão de Documentos." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card titulo="Novo lote">
          <div className="mb-4 space-y-2">
            <Aviso tipo="info">
              Somente arquivos PDF são importados (até 25 MB cada). Arquivos ocultos e de sistema (<code>__MACOSX</code>, <code>Thumbs.db</code>, <code>.DS_Store</code>) são ignorados;
              PDFs que já existem na organização (mesmo conteúdo) são pulados e aparecem no relatório. Um ZIP ao lado de uma pasta de mesmo nome é tratado como cópia dela e ignorado.
              PDFs sem texto entram na fila de OCR depois da importação (a importação não espera por ele).
            </Aviso>
          </div>
          <ImportarEnvio tipos={tipos} pastas={pastas} />
        </Card>
        <Card titulo="Lotes enviados">
          {lotes.linhas.length === 0 ? (
            <p className="text-sm text-slate-600">Nenhuma importação ainda.</p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="lista-importacoes">
              {lotes.linhas.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/ged/importar/${l.id}`} className="font-medium text-primaria-700 underline break-all">{l.nome_arquivo}</Link>
                    <p className="text-xs text-slate-500">{fmtDataHora(l.created_at)} · {l.criado_por} · {l.importados} importado(s), {l.duplicados} duplicado(s), {l.com_erro} com erro</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.status === "RECEBENDO" && <Link href={`/ged/importar/${l.id}`} className="btn-secundario btn-sm">Retomar envio</Link>}
                    <StatusImportacao status={l.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Paginacao page={lotes.page} size={lotes.size} total={lotes.total} href={(p) => `/ged/importar?page=${p}`} />
        </Card>
      </div>
    </>
  );
}
