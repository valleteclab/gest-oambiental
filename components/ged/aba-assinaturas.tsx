// Aba "Assinaturas" da página do documento (frente D): pedir assinatura, acompanhar a solicitação atual e o histórico,
// assinar/recusar (leva à tela de assinatura) e cancelar.
import Link from "next/link";
import { Aviso, Card } from "@/components/ui";
import { ConversaAssinatura } from "@/components/ged/assinaturas/conversa";
import { FormSolicitarAssinatura } from "@/components/ged/assinaturas/form-solicitar";
import { BadgeSolicitacao, ListaSignatarios, ResumoSolicitacao } from "@/components/ged/assinaturas/linha-tempo";
import { FormGed } from "@/components/ged/form-ged";
import { comentariosDeAssinatura, solicitacoesDoDocumento } from "@/lib/ged/assinaturas/consultas";
import { fmtDataHoraBrasilia, podeSolicitarNoStatus } from "@/lib/ged/assinaturas/regras";
import { candidatosSignatarios } from "@/lib/ged/assinaturas/servico";
import { podeSolicitarAssinatura } from "@/lib/ged/papeis";
import { cancelarAssinaturaAction, comentarAssinaturaAction, solicitarAssinaturaAction, tentarSelarAction } from "@/app/(ged)/ged/assinaturas/actions";
import type { PropsAbaGed } from "./tipos-abas";

export default async function AbaAssinaturas({ ctx, documento }: PropsAbaGed) {
  const [solicitacoes, comentarios, config, selo] = await Promise.all([
    solicitacoesDoDocumento(ctx, documento.id),
    comentariosDeAssinatura(ctx, documento.id),
    ctx.db.gedConfig.findFirst({ select: { assinatura_prazo_dias: true } }),
    ctx.db.gedDocumento.findUnique({ where: { id: documento.id }, select: { codigo_verificador: true, sha256_final: true } }),
  ]);
  const aberta = solicitacoes.find((s) => s.status === "ABERTA") ?? null;
  const anteriores = solicitacoes.filter((s) => s.id !== aberta?.id);
  const podeEditar = documento.acoes.includes("EDITAR") || documento.acoes.includes("ADMINISTRAR");
  const podeSolicitar = !aberta && podeSolicitarAssinatura(ctx) && podeEditar && podeSolicitarNoStatus(documento.status);
  const candidatos = podeSolicitar ? await candidatosSignatarios(ctx) : [];
  const gerencia = (autorId: string) => autorId === ctx.usuario.id || documento.acoes.includes("ADMINISTRAR");

  return (
    <div className="space-y-6" data-testid="aba-assinaturas">
      {documento.status === "ASSINADO" && selo?.codigo_verificador && (
        <Aviso tipo="sucesso">
          Documento assinado e selado. Código verificador <strong className="font-mono" data-testid="codigo-verificador">{selo.codigo_verificador}</strong> ·{" "}
          <Link className="underline" href={`/verificar/${selo.codigo_verificador}`} target="_blank">verificar autenticidade (página pública)</Link>.
          {selo.sha256_final && <span className="mt-1 block break-all text-xs">SHA-256 do arquivo selado: <span className="font-mono">{selo.sha256_final}</span></span>}
        </Aviso>
      )}

      {aberta && (
        <Card titulo="Solicitação em andamento" acoes={<BadgeSolicitacao status={aberta.status} />}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4"><ResumoSolicitacao s={aberta} /></div>
            <ListaSignatarios s={aberta} />
          </div>
          <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-slate-100 pt-4">
            {aberta.minha_vez && <Link href={`/ged/assinaturas/${aberta.id}`} className="btn-primario">Assinar ou recusar</Link>}
            <Link href={`/ged/assinaturas/${aberta.id}`} className="btn-secundario">Abrir tela da assinatura</Link>
            {aberta.selo_pendente && gerencia(aberta.criada_por_id) && (
              <FormGed action={tentarSelarAction} botao="Tentar selar novamente" classeBotao="btn-secundario" inline rotuloAcessivel="Tentar selar novamente">
                <input type="hidden" name="solicitacao_id" value={aberta.id} /><input type="hidden" name="documento_id" value={documento.id} />
              </FormGed>
            )}
            {gerencia(aberta.criada_por_id) && (
              <FormGed action={cancelarAssinaturaAction} botao="Cancelar solicitação" classeBotao="btn-perigo" inline confirmar="Cancelar esta solicitação de assinatura?" rotuloAcessivel="Cancelar solicitação">
                <input type="hidden" name="solicitacao_id" value={aberta.id} /><input type="hidden" name="documento_id" value={documento.id} />
              </FormGed>
            )}
          </div>
        </Card>
      )}

      {podeSolicitar && (
        <Card titulo="Solicitar assinatura">
          <p className="mb-3 text-sm text-slate-600">Escolha quem vai assinar a versão atual deste PDF. Cada signatário confirma a senha ao assinar; ao final o documento recebe um selo com QR Code e código verificador.</p>
          <FormSolicitarAssinatura action={solicitarAssinaturaAction} documentoId={documento.id} candidatos={candidatos} prazoPadrao={config?.assinatura_prazo_dias ?? 15} />
        </Card>
      )}
      {!aberta && !podeSolicitar && documento.status !== "ASSINADO" && solicitacoes.length === 0 && (
        <Aviso>Nenhuma assinatura solicitada para este documento{podeSolicitarAssinatura(ctx) ? "" : " (seu papel não permite solicitar assinaturas)"}.</Aviso>
      )}

      {aberta && (aberta.criada_por_id === ctx.usuario.id || aberta.assinantes.some((a) => a.eu)) && (
        <Card titulo="Comentários da assinatura">
          <ConversaAssinatura comentarios={comentarios.filter((c) => c.solicitacao_id === aberta.id)} />
          <div className="mt-4 border-t border-slate-100 pt-4">
            <FormGed action={comentarAssinaturaAction} botao="Comentar" limparAoSalvar rotuloAcessivel="Comentar sobre a assinatura">
              <input type="hidden" name="solicitacao_id" value={aberta.id} /><input type="hidden" name="documento_id" value={documento.id} />
              <div><label className="label" htmlFor="aba-texto-comentario">Novo comentário</label><textarea id="aba-texto-comentario" name="texto" rows={3} maxLength={2000} required className="input" /></div>
            </FormGed>
          </div>
        </Card>
      )}

      {anteriores.length > 0 && (
        <Card titulo={`Histórico de solicitações (${anteriores.length})`}>
          <ol className="space-y-5" aria-label="Solicitações anteriores">
            {anteriores.map((s) => (
              <li key={s.id} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0" data-testid="solicitacao-anterior">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <BadgeSolicitacao status={s.status} />
                  <span className="text-slate-600">{s.criada_por_nome} · {fmtDataHoraBrasilia(s.created_at)} · v{s.versao_n ?? "—"}</span>
                  <Link href={`/ged/assinaturas/${s.id}`} className="ml-auto text-sm text-primaria-700 underline">Detalhes</Link>
                </div>
                <ListaSignatarios s={s} />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
