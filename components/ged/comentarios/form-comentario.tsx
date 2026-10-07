"use client";
import { FormGed } from "@/components/ged/form-ged";
import { comentarAction } from "@/app/(ged)/ged/tramite/comentarios-actions";

export function FormComentario({ documentoId, max }: { documentoId: string; max: number }) {
  return (
    <FormGed action={comentarAction} botao="Publicar comentário" limparAoSalvar rotuloAcessivel="Formulário de novo comentário">
      <input type="hidden" name="documento_id" value={documentoId} />
      <div>
        <label className="label" htmlFor={`comentario-${documentoId}`}>Novo comentário</label>
        <textarea id={`comentario-${documentoId}`} name="texto" className="input min-h-24" rows={4} maxLength={max} required />
        <p className="mt-1 text-xs text-slate-500">Texto simples, até {max} caracteres. Comentários não podem ser editados nem excluídos.</p>
      </div>
      <div>
        <label className="label" htmlFor={`contexto-${documentoId}`}>Assunto</label>
        <select id={`contexto-${documentoId}`} name="contexto" className="input sm:max-w-xs" defaultValue="GERAL">
          <option value="GERAL">Geral</option>
          <option value="TRAMITE">Trâmite</option>
        </select>
      </div>
    </FormGed>
  );
}
