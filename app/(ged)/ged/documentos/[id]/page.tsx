import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Aviso, CabecalhoPagina, Card } from "@/components/ui";
import { AbasDocumento } from "@/components/ged/abas-documento";
import AbaAssinaturas from "@/components/ged/aba-assinaturas";
import AbaComentarios from "@/components/ged/aba-comentarios";
import AbaLogs from "@/components/ged/aba-logs";
import AbaTramite from "@/components/ged/aba-tramite";
import { AclPainelServidor } from "@/components/ged/acl-painel-servidor";
import { FichaDocumento, ListaVersoes, SelosDocumento } from "@/components/ged/ficha-documento";
import { FormGed } from "@/components/ged/form-ged";
import { ZonaArquivoPdf } from "@/components/ged/upload-documento";
import { PreviewPdf } from "@/components/ged/preview-pdf";
import { SeletorMarcadores } from "@/components/ged/seletor-marcadores";
import type { PropsAbaGed } from "@/components/ged/tipos-abas";
import { ErroApi } from "@/lib/http";
import { exigirGed } from "@/lib/ged/escopo";
import { listarMarcadores, marcadoresDoDocumento } from "@/lib/ged/marcadores";
import { podeVerLogs } from "@/lib/ged/papeis";
import { exigirDocumento } from "@/lib/ged/permissoes";
import { apresentacaoOcr, ocrReprocessavel, podeReprocessarOcrPapel } from "@/lib/ged/ocr/decisao";
import { pastasParaSeletor } from "@/lib/ged/pastas";
import { listarTiposDocumento } from "@/lib/ged/tipos-documento";
import { ROTULO_SENSIBILIDADE_GED, SENSIBILIDADES_GED } from "@/lib/ged/tipos";
import { arquivarDocumentoAction, atualizarMetadadosAction, definirDadosPessoaisAction, definirMarcadoresAction, novaVersaoAction, reprocessarOcrAction, reprocessarTextoAction } from "../actions";

export const dynamic = "force-dynamic";

const ABAS = ["visao-geral", "tramite", "comentarios", "assinaturas", "permissoes", "logs"] as const;
type Aba = (typeof ABAS)[number];
const ROTULO_ABA: Record<Aba, string> = { "visao-geral": "Visão geral", tramite: "Trâmite", comentarios: "Comentários", assinaturas: "Assinaturas", permissoes: "Permissões", logs: "Logs" };
const dataIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export async function generateMetadata() {
  return { title: "Documento – Gestão de Documentos" };
}

export default async function PaginaDocumento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const ctx = await exigirGed();
  const { id } = await params;
  const { aba: abaParam } = await searchParams;
  let acoes;
  try {
    ({ acoes } = await exigirDocumento(ctx, id, "VER"));
  } catch (e) {
    if (e instanceof ErroApi && e.status === 403) forbidden();
    notFound();
  }

  const d = await ctx.db.gedDocumento.findUnique({
    where: { id },
    select: {
      id: true, numero: true, titulo: true, status: true, sensibilidade: true, remetente: true, data_documento: true, pasta_id: true, tipo_id: true, acl_propria: true,
      versao_atual_id: true, criado_por_id: true, created_at: true, updated_at: true, contem_dados_pessoais: true, anonimizacao_status: true,
      codigo_verificador: true, sha256_final: true, excluido_em: true,
      tipo: { select: { nome: true } }, pasta: { select: { id: true, caminho_nome: true } },
    },
  });
  if (!d || d.excluido_em) notFound();

  const pode = (a: (typeof acoes)[number]) => acoes.includes(a);
  const abasDisponiveis = ABAS.filter((a) => (a === "permissoes" ? pode("ADMINISTRAR") : a === "logs" ? podeVerLogs(ctx) || pode("ADMINISTRAR") : true));
  const aba: Aba = (abasDisponiveis as readonly string[]).includes(abaParam ?? "") ? (abaParam as Aba) : "visao-geral";
  const base = `/ged/documentos/${id}`;

  const [criador, versoes, marcadores] = await Promise.all([
    ctx.db.usuario.findFirst({ where: { id: d.criado_por_id, organizacao_id: ctx.organizacao_id }, select: { nome: true } }),
    ctx.db.gedVersaoDocumento.findMany({ where: { documento_id: id }, orderBy: { n: "desc" }, select: { id: true, n: true, origem: true, nome_arquivo: true, tamanho: true, sha256: true, paginas: true, texto_status: true, ocr_status: true, ocr_mensagem: true, selada: true, created_at: true } }),
    marcadoresDoDocumento(ctx, id),
  ]);
  const atual = versoes.find((v) => v.id === d.versao_atual_id) ?? versoes[0] ?? null;
  const arquivado = d.status === "ARQUIVADO";
  const propsAba: PropsAbaGed = { ctx, documento: { id: d.id, titulo: d.titulo, numero: d.numero, status: d.status, sensibilidade: d.sensibilidade, versao_atual_id: d.versao_atual_id, acoes } };

  return (
    <>
      <CabecalhoPagina
        titulo={d.titulo}
        subtitulo={<span className="flex flex-wrap items-center gap-2"><span>{d.numero}</span><SelosDocumento d={d} /></span>}
        acoes={
          <>
            {atual && <a className="btn-secundario" href={`/api/v1/ged/documentos/${id}/arquivo?versao=${atual.id}`} download>Baixar PDF</a>}
            {pode("EDITAR") && atual?.origem === "EDITOR" && d.status === "RASCUNHO" && <Link className="btn-primario" href={`/ged/editor/${id}`} prefetch={false}>Continuar no editor</Link>}
            <Link className="btn-secundario" href="/ged/documentos" prefetch={false}>Voltar à lista</Link>
          </>
        }
      />
      {arquivado && <div className="mb-4"><Aviso tipo="alerta">Este documento está arquivado e não aparece nas listas padrão.</Aviso></div>}
      {d.contem_dados_pessoais && d.anonimizacao_status === "PENDENTE" && (
        <div className="mb-4"><Aviso tipo="alerta"><strong>Contém dados pessoais – anonimização pendente.</strong> O original não pode ser divulgado publicamente.</Aviso></div>
      )}

      <AbasDocumento atual={aba} abas={abasDisponiveis.map((a) => ({ id: a, rotulo: ROTULO_ABA[a], href: `${base}?aba=${a}` }))} />
      <div id="painel-aba" role="tabpanel" aria-labelledby={`aba-${aba}`} tabIndex={0} className="rounded-b-md rounded-tr-md border border-t-0 border-slate-200 bg-white p-4 sm:p-5">
        {aba === "visao-geral" && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-6">
              <section aria-label="Visualização do arquivo">
                {atual ? <PreviewPdf documentoId={id} versaoId={atual.id} titulo={d.titulo} /> : <Aviso>Este documento ainda não tem arquivo.</Aviso>}
              </section>
              <Card titulo="Versões">
                <ListaVersoes documentoId={id} versoes={versoes} atualId={d.versao_atual_id} />
                {atual?.ocr_status === "COTA_EXCEDIDA" && <div className="mt-3"><Aviso tipo="alerta">{atual.ocr_mensagem ?? "A cota mensal de OCR foi atingida."} O documento não será pesquisável pelo conteúdo até o OCR ser reprocessado.</Aviso></div>}
                {atual && (atual.texto_status === "ERRO" || atual.texto_status === "SEM_TEXTO") && pode("EDITAR") && (
                  <div className="mt-3">
                    <FormGed action={reprocessarTextoAction} botao="Reprocessar texto" classeBotao="btn-secundario" inline rotuloAcessivel="Reprocessar texto da versão atual">
                      <input type="hidden" name="id" value={id} />
                      <p className="basis-full text-sm text-slate-600">{atual.texto_status === "SEM_TEXTO" ? "Este PDF não tem texto selecionável (provavelmente digitalizado); a busca no conteúdo não o encontra." : "A leitura do texto falhou."}</p>
                    </FormGed>
                  </div>
                )}
                {atual && pode("EDITAR") && podeReprocessarOcrPapel(ctx.membro.papel) && ocrReprocessavel({ ...atual }, d.status) && (
                  <div className="mt-3">
                    <FormGed action={reprocessarOcrAction} botao="Reprocessar OCR" classeBotao="btn-secundario" inline rotuloAcessivel="Reprocessar OCR da versão atual">
                      <input type="hidden" name="id" value={id} />
                      <p className="basis-full text-sm text-slate-600">{atual.ocr_status ? `${apresentacaoOcr(atual.ocr_status).descricao} ` : "Este arquivo digitalizado ainda não passou por OCR. "}O reconhecimento cria uma nova versão pesquisável e preserva o arquivo original.</p>
                    </FormGed>
                  </div>
                )}
                {pode("EDITAR") && !arquivado && (
                  <details className="mt-4 border-t border-slate-100 pt-3">
                    <summary className="cursor-pointer text-sm font-medium text-primaria-700">Enviar nova versão (PDF)</summary>
                    <div className="mt-3">
                      <FormGed action={novaVersaoAction} botao="Enviar nova versão" rotuloAcessivel="Enviar nova versão">
                        <input type="hidden" name="id" value={id} />
                        <ZonaArquivoPdf id="arquivo-versao" />
                      </FormGed>
                    </div>
                  </details>
                )}
              </Card>
            </div>
            <div className="space-y-6">
              <Card titulo="Informações">
                <FichaDocumento d={{ ...d, criado_por_nome: criador?.nome ?? null, marcadores }} />
                {pode("EDITAR") && !arquivado && <EditarMetadados ctx={ctx} d={d} podeAdmin={pode("ADMINISTRAR")} />}
              </Card>
              {pode("EDITAR") && !arquivado && <CardMarcadores ctx={ctx} id={id} selecionados={marcadores.map((m) => m.id)} />}
              {(pode("ANONIMIZAR") || pode("EDITAR")) && (
                <Card titulo="Dados pessoais (LGPD)">
                  <FormGed action={definirDadosPessoaisAction} botao={d.contem_dados_pessoais ? "Remover marcação" : "Marcar como contendo dados pessoais"} classeBotao="btn-secundario" rotuloAcessivel="Dados pessoais">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="contem" value={d.contem_dados_pessoais ? "false" : "true"} />
                    <p className="text-sm text-slate-600">
                      {d.contem_dados_pessoais
                        ? "Este documento está marcado como contendo dados pessoais. Enquanto a anonimização estiver pendente ele não pode ser público."
                        : "Marque se o documento tem CPF, endereço, telefone ou outros dados pessoais. Documentos públicos passam a Restrito até a anonimização."}
                    </p>
                  </FormGed>
                </Card>
              )}
              {pode("ADMINISTRAR") && (
                <Card titulo={arquivado ? "Restaurar" : "Arquivar"}>
                  <FormGed action={arquivarDocumentoAction} botao={arquivado ? "Restaurar documento" : "Arquivar documento"} classeBotao={arquivado ? "btn-secundario" : "btn-perigo"} confirmar={arquivado ? undefined : "Arquivar este documento? Ele deixa de aparecer nas listas padrão."} rotuloAcessivel={arquivado ? "Restaurar documento" : "Arquivar documento"}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="restaurar" value={arquivado ? "true" : "false"} />
                    <p className="text-sm text-slate-600">{arquivado ? "O documento volta às listas com a situação que tinha antes de ser arquivado." : "O documento e seu histórico são mantidos; nada é excluído."}</p>
                  </FormGed>
                </Card>
              )}
            </div>
          </div>
        )}
        {aba === "tramite" && <AbaTramite {...propsAba} />}
        {aba === "comentarios" && <AbaComentarios {...propsAba} />}
        {aba === "assinaturas" && <AbaAssinaturas {...propsAba} />}
        {aba === "permissoes" && pode("ADMINISTRAR") && <AclPainelServidor ctx={ctx} alvo={{ tipo: "documento", id }} caminho={base} herda={!d.acl_propria} />}
        {aba === "logs" && (podeVerLogs(ctx) || pode("ADMINISTRAR")) && <AbaLogs {...propsAba} />}
      </div>
    </>
  );
}

async function CardMarcadores({ ctx, id, selecionados }: { ctx: Awaited<ReturnType<typeof exigirGed>>; id: string; selecionados: string[] }) {
  const todos = await listarMarcadores(ctx);
  return (
    <Card titulo="Marcadores">
      {todos.length === 0 ? (
        <p className="text-sm text-slate-600">Nenhum marcador cadastrado. {ctx.membro.papel === "GED_ADMIN" || ctx.membro.papel === "GED_GESTOR" ? <Link href="/ged/admin/marcadores" className="text-primaria-700 underline">Criar marcadores</Link> : "Peça a um gestor para criá-los."}</p>
      ) : (
        <FormGed action={definirMarcadoresAction} botao="Salvar marcadores" classeBotao="btn-secundario" rotuloAcessivel="Marcadores do documento">
          <input type="hidden" name="id" value={id} />
          <SeletorMarcadores marcadores={todos} selecionados={selecionados} legenda="Aplicar ou remover" />
        </FormGed>
      )}
    </Card>
  );
}

async function EditarMetadados({ ctx, d, podeAdmin }: { ctx: Awaited<ReturnType<typeof exigirGed>>; d: { id: string; titulo: string; tipo_id: string | null; remetente: string | null; data_documento: Date | null; pasta_id: string | null; sensibilidade: (typeof SENSIBILIDADES_GED)[number] }; podeAdmin: boolean }) {
  const [tipos, pastas] = await Promise.all([listarTiposDocumento(ctx), podeAdmin ? pastasParaSeletor(ctx) : Promise.resolve([])]);
  return (
    <details className="mt-4 border-t border-slate-100 pt-3">
      <summary className="cursor-pointer text-sm font-medium text-primaria-700">Editar informações</summary>
      <div className="mt-3">
        <FormGed action={atualizarMetadadosAction} botao="Salvar informações" rotuloAcessivel="Editar informações do documento">
          <input type="hidden" name="id" value={d.id} />
          <div><label className="label" htmlFor="e-titulo">Título</label><input id="e-titulo" name="titulo" className="input" defaultValue={d.titulo} required minLength={3} maxLength={250} /></div>
          <div>
            <label className="label" htmlFor="e-tipo">Tipo de documento</label>
            <select id="e-tipo" name="tipo_id" className="input" defaultValue={d.tipo_id ?? ""}>
              <option value="">Sem tipo</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="e-remetente">Remetente / origem</label><input id="e-remetente" name="remetente" className="input" defaultValue={d.remetente ?? ""} maxLength={200} /></div>
          <div><label className="label" htmlFor="e-data">Data do documento</label><input id="e-data" name="data_documento" type="date" className="input" defaultValue={dataIso(d.data_documento)} /></div>
          {podeAdmin && (
            <>
              <div>
                <label className="label" htmlFor="e-pasta">Pasta</label>
                <select id="e-pasta" name="pasta_id" className="input" defaultValue={d.pasta_id ?? ""}>
                  <option value="">Sem pasta</option>
                  {pastas.map((p) => <option key={p.id} value={p.id}>{p.caminho_nome}</option>)}
                  {d.pasta_id && !pastas.some((p) => p.id === d.pasta_id) && <option value={d.pasta_id}>(pasta atual)</option>}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="e-sens">Sensibilidade</label>
                <select id="e-sens" name="sensibilidade" className="input" defaultValue={d.sensibilidade}>
                  {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
                </select>
              </div>
            </>
          )}
        </FormGed>
      </div>
    </details>
  );
}
