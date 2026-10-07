import { Vazio } from "@/components/ui";
import type { ComentarioAssinaturaView } from "@/lib/ged/assinaturas/consultas";
import { fmtDataHoraBrasilia } from "@/lib/ged/assinaturas/regras";

/** Comentários do contexto de assinatura (ASSINATURA/RECUSA), mais antigos primeiro. */
export function ConversaAssinatura({ comentarios }: { comentarios: ComentarioAssinaturaView[] }) {
  if (comentarios.length === 0) return <Vazio>Nenhum comentário ainda.</Vazio>;
  return (
    <ul className="space-y-3" aria-label="Comentários da assinatura">
      {comentarios.map((c) => (
        <li key={c.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="comentario-assinatura">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{c.autor_nome}{c.contexto === "RECUSA" ? " · recusa" : ""}</span>
            <time dateTime={c.created_at.toISOString()}>{fmtDataHoraBrasilia(c.created_at)}</time>
          </div>
          <p className="whitespace-pre-wrap break-words">{c.texto}</p>
        </li>
      ))}
    </ul>
  );
}
