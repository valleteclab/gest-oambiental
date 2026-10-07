import { Card } from "@/components/ui";
import { FormComentario } from "@/components/ged/comentarios/form-comentario";
import { ListaComentarios } from "@/components/ged/comentarios/lista-comentarios";
import { MAX_COMENTARIO } from "@/lib/ged/comentarios/regras";
import { listarComentarios } from "@/lib/ged/comentarios/servico";
import type { PropsAbaGed } from "./tipos-abas";

/** Aba "Comentários": qualquer pessoa com VER no documento lê e comenta (regra documentada em lib/ged/comentarios/servico.ts). */
export default async function AbaComentarios({ ctx, documento }: PropsAbaGed) {
  const comentarios = await listarComentarios(ctx, documento.id);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card titulo={`Comentários (${comentarios.length})`}>
        <ListaComentarios comentarios={comentarios} />
      </Card>
      <Card titulo="Comentar">
        <FormComentario documentoId={documento.id} max={MAX_COMENTARIO} />
      </Card>
    </div>
  );
}
