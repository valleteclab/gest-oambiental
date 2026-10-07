import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { PreviewPdf } from "@/components/ged/preview-pdf";
import { ConversaAssinatura } from "@/components/ged/assinaturas/conversa";
import { ListaSignatarios, ResumoSolicitacao } from "@/components/ged/assinaturas/linha-tempo";
import { detalheSolicitacao } from "@/lib/ged/assinaturas/consultas";
import { fmtDataHoraBrasilia, MIN_JUSTIFICATIVA, TEXTO_CONSENTIMENTO } from "@/lib/ged/assinaturas/regras";
import { registrarVisualizacao } from "@/lib/ged/assinaturas/servico";
import { NaoEncontradoGed } from "@/lib/ged/db";
import { exigirGed } from "@/lib/ged/escopo";
import { ErroApi } from "@/lib/http";
import { assinarAction, cancelarAssinaturaAction, comentarAssinaturaAction, recusarAction, tentarSelarAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assinar documento – Gestão de Documentos" };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaAssinar({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirGed();
  const { id } = await params;
  if (!RE_UUID.test(id)) notFound();
  let det;
  try {
    det = await detalheSolicitacao(ctx, id);
  } catch (e) {
    if (e instanceof NaoEncontradoGed || (e instanceof ErroApi && e.status === 404)) notFound();
    throw e;
  }
  const { solicitacao: s, documento: d, comentarios, acoes } = det;
  const eu = s.assinantes.find((a) => a.eu);
  const souAutor = s.criada_por_id === ctx.usuario.id;
  const aberta = s.status === "ABERTA";
  if (eu && aberta && (eu.status === "PENDENTE" || eu.status === "AGUARDANDO")) await registrarVisualizacao(ctx, s.id);
  const podeCancelar = aberta && (souAutor || acoes.includes("ADMINISTRAR"));
  const participa = souAutor || !!eu;

  return (
    <>
      <CabecalhoPagina
        titulo="Assinatura do documento"
        subtitulo={<>{d.numero} – {d.titulo}</>}
        acoes={<Link href={`/ged/documentos/${d.id}?aba=assinaturas`} className="btn-secundario">Voltar ao documento</Link>}
      />

      {eu?.status === "ASSINADO" && (
        <div className="mb-4"><Aviso tipo="sucesso">Você assinou este documento em <strong>{fmtDataHoraBrasilia(eu.assinado_em)}</strong> (assinatura eletrônica avançada).</Aviso></div>
      )}
      {eu?.status === "RECUSADO" && <div className="mb-4"><Aviso tipo="alerta">Você recusou a assinatura em {fmtDataHoraBrasilia(eu.recusado_em)}.</Aviso></div>}
      {!aberta && s.status !== "CONCLUIDA" && <div className="mb-4"><Aviso tipo="info">Esta solicitação está encerrada ({s.status.toLowerCase()}). Não é mais possível assinar.</Aviso></div>}
      {s.status === "CONCLUIDA" && d.codigo_verificador && (
        <div className="mb-4"><Aviso tipo="sucesso">Documento selado. Código verificador <strong className="font-mono">{d.codigo_verificador}</strong> · <Link className="underline" href={`/verificar/${d.codigo_verificador}`} target="_blank">verificar autenticidade</Link>.</Aviso></div>
      )}
      {s.selo_pendente && (
        <div className="mb-4">
          <Aviso tipo="alerta">
            Todas as assinaturas foram feitas, mas o selo do documento ainda não foi concluído. Será refeito automaticamente.
            {(souAutor || acoes.includes("ADMINISTRAR")) && (
              <FormGed action={tentarSelarAction} botao="Tentar selar agora" classeBotao="btn-secundario" inline className="mt-2" rotuloAcessivel="Tentar selar novamente">
                <input type="hidden" name="solicitacao_id" value={s.id} /><input type="hidden" name="documento_id" value={d.id} />
              </FormGed>
            )}
          </Aviso>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card titulo="Documento a assinar">
            <PreviewPdf documentoId={d.id} versaoId={s.versao_id} titulo={d.titulo} />
            <p className="mt-3 break-all text-xs text-slate-500">Versão {s.versao_n ?? "—"} · SHA-256 do arquivo: <span className="font-mono">{s.sha256_alvo}</span></p>
          </Card>
          <Card titulo="Comentários sobre a assinatura">
            <ConversaAssinatura comentarios={comentarios} />
            {aberta && participa && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <FormGed action={comentarAssinaturaAction} botao="Comentar" limparAoSalvar rotuloAcessivel="Comentar sobre a assinatura">
                  <input type="hidden" name="solicitacao_id" value={s.id} /><input type="hidden" name="documento_id" value={d.id} />
                  <div><label className="label" htmlFor="texto-comentario">Novo comentário</label><textarea id="texto-comentario" name="texto" rows={3} maxLength={2000} required className="input" /></div>
                </FormGed>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card titulo="Solicitação"><ResumoSolicitacao s={s} /></Card>
          <Card titulo="Signatários"><ListaSignatarios s={s} /></Card>

          {s.minha_vez && (
            <Card titulo="Assinar">
              <FormGed action={assinarAction} botao="Assinar documento" rotuloAcessivel="Assinar documento">
                <input type="hidden" name="solicitacao_id" value={s.id} /><input type="hidden" name="documento_id" value={d.id} />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="consentimento" required className="mt-1" />
                  <span>{TEXTO_CONSENTIMENTO}</span>
                </label>
                <div>
                  <label className="label" htmlFor="senha-assinatura">Confirme sua senha</label>
                  <input id="senha-assinatura" name="senha" type="password" required autoComplete="current-password" className="input" />
                  <p className="mt-1 text-xs text-slate-500">A senha é pedida a cada assinatura. Após 5 tentativas erradas o ato é bloqueado por alguns minutos.</p>
                </div>
              </FormGed>
              <details className="mt-5 border-t border-slate-100 pt-4">
                <summary className="cursor-pointer text-sm font-medium text-red-800">Recusar assinatura</summary>
                <div className="mt-3">
                  <FormGed action={recusarAction} botao="Recusar assinatura" classeBotao="btn-perigo" confirmar="Confirmar a recusa? O autor será avisado e a solicitação será encerrada." rotuloAcessivel="Recusar assinatura">
                    <input type="hidden" name="solicitacao_id" value={s.id} /><input type="hidden" name="documento_id" value={d.id} />
                    <div>
                      <label className="label" htmlFor="justificativa-recusa">Justificativa (obrigatória)</label>
                      <textarea id="justificativa-recusa" name="justificativa" rows={3} required minLength={MIN_JUSTIFICATIVA} maxLength={2000} className="input" />
                      <p className="mt-1 text-xs text-slate-500">Mínimo de {MIN_JUSTIFICATIVA} caracteres. Fica registrada no histórico do documento.</p>
                    </div>
                  </FormGed>
                </div>
              </details>
            </Card>
          )}
          {aberta && eu?.status === "AGUARDANDO" && <Aviso tipo="info">Ainda não é a sua vez: aguarde os signatários anteriores{s.da_vez_nome ? ` (agora: ${s.da_vez_nome})` : ""}.</Aviso>}
          {aberta && eu?.status === "PENDENTE" && !s.minha_vez && <Badge cor="amarelo">Aguardando liberação</Badge>}

          {podeCancelar && (
            <Card titulo="Cancelar solicitação">
              <FormGed action={cancelarAssinaturaAction} botao="Cancelar solicitação" classeBotao="btn-perigo" confirmar="Cancelar esta solicitação de assinatura?" rotuloAcessivel="Cancelar solicitação">
                <input type="hidden" name="solicitacao_id" value={s.id} /><input type="hidden" name="documento_id" value={d.id} />
                <div><label className="label" htmlFor="motivo-cancelamento">Motivo (opcional)</label><input id="motivo-cancelamento" name="motivo" maxLength={500} className="input" /></div>
              </FormGed>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
