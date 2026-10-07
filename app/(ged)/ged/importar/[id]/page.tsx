import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card, Paginacao } from "@/components/ui";
import { AutoAtualizar } from "@/components/ged/auto-atualizar";
import { ImportarEnvio } from "@/components/ged/importar-envio";
import { EM_ANDAMENTO, StatusImportacao } from "@/components/ged/status-importacao";
import { ErroApi } from "@/lib/http";
import { fmtDataHora } from "@/lib/format";
import { exigirGed } from "@/lib/ged/escopo";
import { listarItensImportacao, obterImportacao } from "@/lib/ged/importacao/servico";
import { formatarBytes } from "@/lib/ged/importacao/cliente";
import { podeImportarGed } from "@/lib/ged/papeis";
import { ROTULO_SENSIBILIDADE_GED } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importação – Gestão de Documentos" };

const FILTROS = [["", "Todos"], ["RECEBIDO", "Aguardando"], ["IMPORTADO", "Importados"], ["DUPLICADO", "Duplicados"], ["IGNORADO", "Ignorados"], ["ERRO", "Com erro"]] as const;
const COR = { RECEBIDO: "amarelo", IMPORTADO: "verde", DUPLICADO: "azul", IGNORADO: "cinza", ERRO: "vermelho" } as const;
const ROTULO = { RECEBIDO: "Aguardando", IMPORTADO: "Importado", DUPLICADO: "Duplicado", IGNORADO: "Ignorado", ERRO: "Erro" } as const;

export default async function PaginaImportacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const ctx = await exigirGed();
  if (!podeImportarGed(ctx)) forbidden();
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  let lote, itens;
  try {
    lote = await obterImportacao(ctx, id);
    itens = await listarItensImportacao(ctx, id, { status: sp.status, page, size: 50 });
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    throw e;
  }
  const ativo = EM_ANDAMENTO.includes(lote.status);
  const aberto = lote.status === "RECEBENDO";
  const feitos = lote.importados + lote.duplicados + lote.ignorados + lote.com_erro;
  const qs = (p: number, status = sp.status) => `/ged/importar/${id}?${new URLSearchParams({ ...(status ? { status } : {}), page: String(p) })}`;
  return (
    <>
      <AutoAtualizar ativo={ativo} />
      <CabecalhoPagina
        titulo={`Importação: ${lote.nome_arquivo}`}
        subtitulo={`Enviada por ${lote.criado_por} em ${fmtDataHora(lote.created_at)}`}
        acoes={<><Link href="/ged/importar" className="btn-secundario">Voltar</Link>{!ativo && <a href={`/api/v1/ged/importacoes/${id}?formato=csv`} className="btn-secundario">Baixar relatório (CSV)</a>}</>}
      />
      <div className="space-y-6">
        {aberto && (
          <Card titulo="Retomar envio">
            <p className="mb-3 text-sm text-slate-600">Este lote ainda está aguardando arquivos (o envio foi interrompido ou não foi concluído). Escolha de novo a mesma {lote.origem === "PASTA" ? "pasta" : "ZIP"}: só o que falta será enviado.</p>
            <ImportarEnvio tipos={[]} pastas={[]} lote={{ id, origem: lote.origem, nome: lote.nome_arquivo }} />
          </Card>
        )}
        <Card titulo="Resumo">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <StatusImportacao status={lote.status} />
            <span>Destino: <strong>{lote.pasta_destino ?? "Raiz"}</strong></span>
            <span>Sensibilidade: <strong>{ROTULO_SENSIBILIDADE_GED[lote.sensibilidade]}</strong></span>
            <span>Origem: <strong>{lote.origem === "PASTA" ? "Pasta enviada pelo navegador" : "ZIP"}</strong></span>
            {lote.unir_pastas && <span>Pastas repetidas unidas (A/A → A)</span>}
            {lote.concluido_em && <span>Concluída em {fmtDataHora(lote.concluido_em)}</span>}
          </div>
          {lote.erro && <div className="mb-3"><Aviso tipo="erro">{lote.erro}</Aviso></div>}
          {ativo && <p className="mb-3 text-sm text-slate-600" role="status">Processando: {feitos} de {lote.total_arquivos || "…"} arquivo(s). Esta página se atualiza sozinha.</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-4" data-testid="contadores-importacao">
            {([["Arquivos no lote", lote.total_arquivos, "total"], ["Importados", lote.importados, "importados"], ["Duplicados", lote.duplicados, "duplicados"], ["Ignorados", lote.ignorados, "ignorados"], ["Com erro", lote.com_erro, "erros"], ["Pastas criadas", lote.pastas_criadas, "pastas"], ["Tamanho importado", formatarBytes(lote.tamanho_importado ?? 0), "tamanho-importado"], ["Tamanho total recebido", formatarBytes(lote.tamanho_total ?? 0), "tamanho-total"]] as const).map(([r, v, k]) => (
              <div key={k} className="rounded-md border border-slate-200 p-3"><dt className="text-xs text-slate-500">{r}</dt><dd className="text-xl font-semibold" data-testid={`contador-${k}`}>{v}</dd></div>
            ))}
          </dl>
          {lote.ocultos > 0 && <p className="mt-3 text-xs text-slate-500">{lote.ocultos} arquivo(s) oculto(s) ou de sistema foram ignorados sem aparecer no relatório.</p>}
        </Card>
        <Card titulo="Relatório por arquivo">
          <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filtrar relatório">
            {FILTROS.map(([v, r]) => (
              <Link key={v} href={qs(1, v)} className={(sp.status ?? "") === v ? "btn-primario btn-sm" : "btn-secundario btn-sm"}>{r}</Link>
            ))}
          </nav>
          {itens.itens.length === 0 ? (
            <p className="text-sm text-slate-600">Nenhum item {ativo ? "processado ainda" : "neste filtro"}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela" data-testid="tabela-itens-importacao">
                <thead><tr><th>Caminho</th><th>Situação</th><th>Detalhe</th></tr></thead>
                <tbody>
                  {itens.itens.map((i) => (
                    <tr key={i.id}>
                      <td className="break-all">{i.documento_id && i.status === "IMPORTADO" ? <Link className="text-primaria-700 underline" href={`/ged/documentos/${i.documento_id}`}>{i.caminho}</Link> : i.caminho}</td>
                      <td><Badge cor={COR[i.status]}>{ROTULO[i.status]}</Badge></td>
                      <td className="text-slate-600">{i.motivo ?? ""}{i.documento_id && i.status === "DUPLICADO" && <> <Link className="text-primaria-700 underline" href={`/ged/documentos/${i.documento_id}`}>Abrir</Link></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Paginacao page={itens.page} size={itens.size} total={itens.total} href={(p) => qs(p)} />
        </Card>
      </div>
    </>
  );
}
