import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { PainelAcoesProtocolo } from "@/components/ged/protocolo/painel-acoes";
import { NaoEncontradoGed } from "@/lib/ged/db";
import { exigirGed } from "@/lib/ged/escopo";
import { COR_SITUACAO, ROTULO_LIVRO, ROTULO_PRIORIDADE } from "@/lib/ged/protocolo/regras";
import { obterProtocolo, opcoesProtocolo, type FichaProtocolo } from "@/lib/ged/protocolo/servico";
import { docFormatado } from "@/lib/ged/protocolo/pessoal";
import { fmtDataHora } from "@/lib/format";
import { ErroApi } from "@/lib/http";

export const dynamic = "force-dynamic";
export const metadata = { title: "Protocolo – Gestão de Documentos" };

const tam = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const Linha = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid gap-1 py-2 sm:grid-cols-3 sm:gap-4"><dt className="text-sm font-medium text-slate-600">{k}</dt><dd className="min-w-0 break-words text-sm text-slate-900 sm:col-span-2">{children}</dd></div>
);

export default async function FichaProtocoloPagina({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirGed();
  const { id } = await params;
  let p: FichaProtocolo;
  try {
    p = await obterProtocolo(ctx, id);
  } catch (e) {
    if (e instanceof NaoEncontradoGed || (e instanceof ErroApi && e.status === 404)) notFound();
    throw e;
  }
  const opcoes = p.pode_agir ? await opcoesProtocolo(ctx) : { setores: [], usuarios: [], tipos: [] };
  return (
    <>
      <CabecalhoPagina
        titulo={p.numero}
        subtitulo={<><Link href="/ged/protocolo" prefetch={false} className="underline">Protocolo</Link> · {ROTULO_LIVRO[p.livro]} · registrado em {fmtDataHora(p.created_at)}</>}
        acoes={p.comprovante.emitido ? <a href={`/api/v1/ged/protocolos/${p.id}/comprovante`} className="btn-secundario" data-testid="baixar-comprovante">Baixar comprovante (PDF)</a> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card titulo="Dados do protocolo">
            <dl className="divide-y divide-slate-100">
              <Linha k="Situação"><span data-testid="situacao-protocolo"><Badge cor={COR_SITUACAO[p.situacao]}>{p.situacao_rotulo}</Badge></span></Linha>
              <Linha k="Assunto">{p.assunto}</Linha>
              {p.descricao && <Linha k="Descrição"><span className="whitespace-pre-wrap">{p.descricao}</span></Linha>}
              {p.interessado && (
                <Linha k={p.livro === "SAIDA" ? "Destinatário" : "Interessado"}>
                  <div>{p.interessado.nome ?? "—"}</div>
                  {p.interessado.cpf_cnpj && <div className="text-slate-600">CPF/CNPJ: {p.pode_agir ? docFormatado(p.interessado.cpf_cnpj) : p.interessado.cpf_cnpj}</div>}
                  {p.interessado.email && <div className="text-slate-600">E-mail: {p.interessado.email}</div>}
                  {p.interessado.telefone && <div className="text-slate-600">Telefone: {p.interessado.telefone}</div>}
                </Linha>
              )}
              {p.origem_setor && <Linha k="Setor de origem">{p.origem_setor}</Linha>}
              {(p.destino_setor || p.destino_usuario) && <Linha k="Destino">{[p.destino_setor, p.destino_usuario].filter(Boolean).join(" · ")}</Linha>}
              <Linha k="Com">{[p.setor_atual, p.responsavel].filter(Boolean).join(" · ") || "—"}</Linha>
              <Linha k="Prioridade">{ROTULO_PRIORIDADE[p.prioridade]}</Linha>
              {p.tipo_documento && <Linha k="Tipo de documento">{p.tipo_documento}</Linha>}
              {p.prazo_resposta_em && <Linha k="Prazo de resposta">{fmtDataHora(p.prazo_resposta_em)}</Linha>}
              <Linha k="Origem">{p.origem === "PORTAL" ? "Portal do cidadão (protocolo online)" : `Registrado por ${p.criado_por ?? "servidor"}`}</Linha>
              {p.consentimento_lgpd_em && <Linha k="Aceite de LGPD">{fmtDataHora(p.consentimento_lgpd_em)}</Linha>}
              {p.codigo_consulta && <Linha k="Código de consulta"><span className="font-mono" data-testid="codigo-consulta">{p.codigo_consulta}</span> <span className="text-xs text-slate-500">(o interessado acompanha com o número e este código)</span></Linha>}
              <Linha k="Comprovante">
                {p.comprovante.emitido ? (
                  <span data-testid="comprovante-info">Emitido em {p.comprovante.emitido_em ? fmtDataHora(p.comprovante.emitido_em) : "—"} · {p.comprovante.assinado ? "assinado com o certificado do órgão (PAdES)" : "assinatura eletrônica simples"}<br /><span className="break-all font-mono text-xs text-slate-500">SHA-256 {p.comprovante.sha256}</span><br /><Link href={`/verificar/protocolo/${p.codigo_verificacao}`} className="text-xs underline" prefetch={false} target="_blank">Página pública de verificação</Link></span>
                ) : "Ainda não emitido."}
              </Linha>
            </dl>
          </Card>

          <Card titulo={`Anexos (${p.anexos.length})`}>
            {p.anexos.length === 0 ? <p className="text-sm text-slate-600">Nenhum arquivo anexado.</p> : (
              <ul className="divide-y divide-slate-100" data-testid="anexos-protocolo">
                {p.anexos.map((a) => (
                  <li key={a.documento_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      {a.visivel ? <Link href={`/ged/documentos/${a.documento_id}`} prefetch={false} className="break-words font-medium text-primaria-700 hover:underline">{a.nome}</Link> : <span className="text-slate-500" title="Você não tem permissão para ver este documento">{a.nome}</span>}
                      <div className="text-xs text-slate-500">{a.finalidade === "RESPOSTA" ? "Resposta · " : ""}{tam(a.tamanho)}{a.visivel && a.numero ? ` · ${a.numero}` : ""}</div>
                    </div>
                    <span className="break-all font-mono text-[11px] text-slate-500">{a.sha256.slice(0, 16)}…</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card titulo="Andamento">
            <ol className="space-y-3" data-testid="andamento-protocolo">
              {p.eventos.map((e) => (
                <li key={e.id} className="rounded-md border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{e.rotulo}</span>
                    <span className="text-xs text-slate-500">{fmtDataHora(e.created_at)}</span>
                  </div>
                  <div className="mt-1 text-slate-600">
                    <Badge cor={COR_SITUACAO[e.situacao_para]}>{e.situacao_rotulo}</Badge>
                    {e.autor && <span className="ml-2">por {e.autor}</span>}
                    {e.destino && <span className="ml-2">para {e.destino}</span>}
                  </div>
                  {e.texto && <p className="mt-2 whitespace-pre-wrap text-slate-800">{e.texto}</p>}
                  {e.texto_publico && <p className="mt-1 text-xs text-slate-500">Visível ao interessado na consulta pública.</p>}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-slate-500">O andamento é imutável: não pode ser alterado nem excluído.</p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card titulo="Ações">
            {p.pode_agir ? <PainelAcoesProtocolo id={p.id} acoes={p.acoes} opcoes={opcoes} semComprovante={!p.comprovante.emitido} /> : <Aviso>Você pode consultar este protocolo, mas não movimentá-lo.</Aviso>}
          </Card>
        </div>
      </div>
    </>
  );
}
