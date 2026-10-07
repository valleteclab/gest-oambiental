import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { EditorCarregador } from "@/components/ged/editor/editor-carregador";
import { FormGed } from "@/components/ged/form-ged";
import { ErroApi } from "@/lib/http";
import { abrirEditor } from "@/lib/ged/editor/servico";
import { exigirGed } from "@/lib/ged/escopo";
import { COR_STATUS_DOCUMENTO_GED, ROTULO_STATUS_DOCUMENTO_GED } from "@/lib/ged/tipos";
import type { GedStatusDocumento } from "@prisma/client";
import { reabrirAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editor de texto" };

export default async function PaginaEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await exigirGed();
  let dados;
  try {
    dados = await abrirEditor(ctx, id);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    if (e instanceof ErroApi && e.status === 403) forbidden();
    throw e;
  }
  const { documento, estado } = dados;
  const status = documento.status as GedStatusDocumento;
  return (
    <>
      <CabecalhoPagina
        titulo={documento.titulo}
        subtitulo={
          <span className="flex flex-wrap items-center gap-2">
            <span>{documento.numero}</span>
            <Badge cor={COR_STATUS_DOCUMENTO_GED[status]}>{ROTULO_STATUS_DOCUMENTO_GED[status]}</Badge>
          </span>
        }
        acoes={<Link href={`/ged/documentos/${documento.id}`} prefetch={false} className="btn-secundario btn-sm">Voltar ao documento</Link>}
      />
      {estado.tipo === "RASCUNHO" && <EditorCarregador documentoId={documento.id} htmlInicial={dados.html} atualizadoEm={dados.atualizado_em} />}
      {estado.tipo === "REABRIR" && (
        <Card titulo="Editar documento finalizado">
          <p className="mb-4 text-sm text-slate-700">Este documento já foi finalizado. Ao editar, o conteúdo atual é aberto como rascunho e, ao finalizar de novo, uma <strong>nova versão</strong> é criada (as versões anteriores continuam guardadas).</p>
          <FormGed action={reabrirAction} botao="Editar (criar nova versão)" rotuloAcessivel="Reabrir para edição">
            <input type="hidden" name="documento_id" value={documento.id} />
          </FormGed>
        </Card>
      )}
      {estado.tipo === "BLOQUEADO" && <Aviso tipo="alerta">{estado.motivo}</Aviso>}
    </>
  );
}
