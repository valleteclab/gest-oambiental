import { Badge } from "@/components/ui";
import type { ComentarioView } from "@/lib/ged/comentarios/servico";
import { ROTULO_CONTEXTO_COMENTARIO } from "@/lib/ged/comentarios/regras";
import { fmtDataHoraBR } from "@/lib/ged/tramite/regras";

const COR: Record<string, "cinza" | "azul" | "vermelho" | "roxo"> = { GERAL: "cinza", ASSINATURA: "azul", RECUSA: "vermelho", TRAMITE: "roxo" };

/** Conversa do documento (mais antigo primeiro). O texto é renderizado como texto (React escapa) com quebras de linha. */
export function ListaComentarios({ comentarios }: { comentarios: ComentarioView[] }) {
  if (comentarios.length === 0) return <p className="py-4 text-sm text-slate-600">Nenhum comentário ainda.</p>;
  return (
    <ol className="space-y-3" aria-label="Comentários do documento" data-testid="lista-comentarios">
      {comentarios.map((c) => (
        <li key={c.id} className="rounded-md border border-slate-200 bg-white p-3" data-contexto={c.contexto}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-slate-900">{c.autor_nome}</span>
            <Badge cor={COR[c.contexto] ?? "cinza"}>{(ROTULO_CONTEXTO_COMENTARIO as Record<string, string>)[c.contexto] ?? c.contexto}</Badge>
            {c.versao_n !== null && <span className="text-xs text-slate-500">versão {c.versao_n}</span>}
            <time className="text-xs text-slate-600" dateTime={c.created_at.toISOString()}>{fmtDataHoraBR(c.created_at)}</time>
          </div>
          <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-800">{c.texto}</p>
        </li>
      ))}
    </ol>
  );
}
