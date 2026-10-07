import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { AclPainelServidor } from "@/components/ged/acl-painel-servidor";
import { ArvorePastas } from "@/components/ged/arvore-pastas";
import { FormGed } from "@/components/ged/form-ged";
import { ListaDocumentos } from "@/components/ged/lista-documentos";
import { ErroApi } from "@/lib/http";
import { exigirGed } from "@/lib/ged/escopo";
import { lerFiltros } from "@/lib/ged/documentos/filtros";
import { listarDocumentos } from "@/lib/ged/documentos/listar";
import { podeCriarDocumento, podeGerirEstruturaGed } from "@/lib/ged/papeis";
import { exigirPasta } from "@/lib/ged/permissoes";
import { listarPastas, montarArvore } from "@/lib/ged/pastas";
import { ROTULO_SENSIBILIDADE_GED, SENSIBILIDADES_GED } from "@/lib/ged/tipos";
import { arquivarPastaAction, atualizarPastaAction, criarPastaAction, moverPastaAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pastas – Gestão de Documentos" };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaPastas({ searchParams }: { searchParams: Promise<{ pasta?: string; arquivadas?: string }> }) {
  const ctx = await exigirGed();
  const sp = await searchParams;
  const gerir = podeGerirEstruturaGed(ctx);
  const todas = await listarPastas(ctx, { incluirArquivadas: true });
  const ativas = todas.filter((p) => !p.arquivada);
  const arvore = montarArvore(ativas);
  const selId = sp.pasta && RE_UUID.test(sp.pasta) ? sp.pasta : null;
  const sel = selId ? todas.find((p) => p.id === selId) : undefined;
  if (selId && !sel) notFound();

  let acoes: Awaited<ReturnType<typeof exigirPasta>>["acoes"] = [];
  if (selId) {
    try {
      ({ acoes } = await exigirPasta(ctx, selId, "VER"));
    } catch (e) {
      if (e instanceof ErroApi) notFound();
      throw e;
    }
  }
  const arquivadas = todas.filter((p) => p.arquivada);

  return (
    <>
      <CabecalhoPagina titulo="Pastas" subtitulo="Organize os documentos em pastas; as permissões de uma pasta valem para o que está dentro dela." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card titulo="Árvore de pastas">
            <ArvorePastas arvore={arvore} selecionada={selId} />
          </Card>
          {gerir && (
            <Card titulo="Nova pasta na raiz">
              <FormGed action={criarPastaAction} botao="Criar pasta" classeBotao="btn-secundario" limparAoSalvar rotuloAcessivel="Nova pasta na raiz">
                <div><label className="label" htmlFor="raiz-nome">Nome</label><input id="raiz-nome" name="nome" className="input" required maxLength={120} /></div>
                <div>
                  <label className="label" htmlFor="raiz-sens">Sensibilidade padrão dos documentos</label>
                  <select id="raiz-sens" name="sensibilidade_padrao" className="input" defaultValue="RESTRITO">
                    {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
                  </select>
                </div>
              </FormGed>
            </Card>
          )}
          {gerir && arquivadas.length > 0 && (
            <Card titulo="Pastas arquivadas">
              <ul className="divide-y divide-slate-100 text-sm">
                {arquivadas.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="break-words">{p.caminho_nome}</span>
                    {acoesPodeAdmin(ctx.membro.papel) && (
                      <FormGed action={arquivarPastaAction} botao="Restaurar" classeBotao="btn-secundario" inline rotuloAcessivel={`Restaurar pasta ${p.nome}`}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="restaurar" value="true" />
                      </FormGed>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {!sel ? (
            <Card><p className="text-sm text-slate-600">Escolha uma pasta na árvore para ver os documentos, as permissões e as opções de gestão.</p></Card>
          ) : (
            <PainelPasta ctx={ctx} sel={sel} acoes={acoes} todas={ativas} gerir={gerir} />
          )}
        </div>
      </div>
    </>
  );
}

const acoesPodeAdmin = (papel: string) => papel === "GED_ADMIN" || papel === "GED_GESTOR";

async function PainelPasta({ ctx, sel, acoes, todas, gerir }: {
  ctx: Awaited<ReturnType<typeof exigirGed>>;
  sel: Awaited<ReturnType<typeof listarPastas>>[number];
  acoes: string[];
  todas: Awaited<ReturnType<typeof listarPastas>>;
  gerir: boolean;
}) {
  const f = lerFiltros({ pasta: sel.id });
  const docs = await listarDocumentos(ctx, { ...f, size: 10 }, { snippets: false });
  const podeEditar = gerir && acoes.includes("EDITAR");
  const podeAdmin = gerir && acoes.includes("ADMINISTRAR");
  const destinos = todas.filter((p) => p.id !== sel.id && !p.caminho_nome.startsWith(`${sel.caminho_nome}/`));
  return (
    <>
      <Card
        titulo={<span className="break-words">{sel.caminho_nome}</span>}
        acoes={sel.arquivada ? <Badge cor="cinza">Arquivada</Badge> : <Badge cor="azul">Padrão: {ROTULO_SENSIBILIDADE_GED[sel.sensibilidade_padrao]}</Badge>}
      >
        <div className="flex flex-wrap gap-2">
          {podeCriarDocumento(ctx) && acoes.includes("EDITAR") && <Link href={`/ged/documentos/novo?pasta=${sel.id}`} prefetch={false} className="btn-primario btn-sm">Novo documento nesta pasta</Link>}
          <Link href={`/ged/documentos?pasta=${sel.id}`} prefetch={false} className="btn-secundario btn-sm">Buscar nesta pasta</Link>
          {!sel.arquivada && <a href={`/api/v1/ged/pastas/${sel.id}/zip`} download className="btn-secundario btn-sm">Baixar pasta (ZIP)</a>}
        </div>
        {!sel.arquivada && <p className="mt-2 text-xs text-slate-500">O ZIP leva esta pasta e as subpastas, na mesma organização, só com os documentos que você pode ver (versão atual), mais MANIFESTO.csv e LEIAME.txt. Acima de 20.000 documentos, baixe por subpasta.</p>}
        <h3 className="mb-2 mt-4 text-sm font-semibold">Documentos ({docs.total})</h3>
        <ListaDocumentos linhas={docs.linhas} comBusca={false} />
        {docs.total > docs.linhas.length && <p className="mt-2 text-sm"><Link className="text-primaria-700 underline" href={`/ged/documentos?pasta=${sel.id}`} prefetch={false}>Ver todos os {docs.total} documentos</Link></p>}
      </Card>

      {podeEditar && (
        <Card titulo="Gerenciar pasta">
          <div className="grid gap-6 md:grid-cols-2">
            <FormGed action={criarPastaAction} botao="Criar subpasta" classeBotao="btn-secundario" limparAoSalvar rotuloAcessivel="Nova subpasta">
              <input type="hidden" name="parent_id" value={sel.id} />
              <div><label className="label" htmlFor="sub-nome">Nova subpasta</label><input id="sub-nome" name="nome" className="input" required maxLength={120} /></div>
              <div>
                <label className="label" htmlFor="sub-sens">Sensibilidade padrão</label>
                <select id="sub-sens" name="sensibilidade_padrao" className="input" defaultValue={sel.sensibilidade_padrao}>
                  {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
                </select>
              </div>
            </FormGed>
            <FormGed action={atualizarPastaAction} botao="Salvar nome e sensibilidade" classeBotao="btn-secundario" rotuloAcessivel="Renomear pasta">
              <input type="hidden" name="id" value={sel.id} />
              <div><label className="label" htmlFor="ren-nome">Nome da pasta</label><input id="ren-nome" name="nome" className="input" defaultValue={sel.nome} required maxLength={120} /></div>
              <div>
                <label className="label" htmlFor="ren-sens">Sensibilidade padrão dos novos documentos</label>
                <select id="ren-sens" name="sensibilidade_padrao" className="input" defaultValue={sel.sensibilidade_padrao}>
                  {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
                </select>
              </div>
            </FormGed>
            {podeAdmin && (
              <FormGed action={moverPastaAction} botao="Mover pasta" classeBotao="btn-secundario" rotuloAcessivel="Mover pasta">
                <input type="hidden" name="id" value={sel.id} />
                <div>
                  <label className="label" htmlFor="mov-pai">Mover para</label>
                  <select id="mov-pai" name="parent_id" className="input" defaultValue={sel.parent_id ?? ""}>
                    <option value="">(Raiz)</option>
                    {destinos.map((p) => <option key={p.id} value={p.id}>{p.caminho_nome}</option>)}
                  </select>
                </div>
              </FormGed>
            )}
            {podeAdmin && (
              <FormGed action={arquivarPastaAction} botao="Arquivar pasta" classeBotao="btn-perigo" confirmar="Arquivar esta pasta? Ela precisa estar vazia." rotuloAcessivel="Arquivar pasta">
                <input type="hidden" name="id" value={sel.id} />
                <p className="text-sm text-slate-600">A pasta precisa estar sem subpastas e sem documentos ativos. Pode ser restaurada depois.</p>
              </FormGed>
            )}
          </div>
        </Card>
      )}

      {acoes.includes("ADMINISTRAR") && (
        <Card titulo="Permissões da pasta">
          <AclPainelServidor ctx={ctx} alvo={{ tipo: "pasta", id: sel.id }} caminho="/ged/pastas" herda={sel.herda_acl} />
          <div className="mt-3"><Aviso tipo="info">As permissões concedidas aqui valem para os documentos desta pasta e das subpastas que herdam permissões.</Aviso></div>
        </Card>
      )}
    </>
  );
}
