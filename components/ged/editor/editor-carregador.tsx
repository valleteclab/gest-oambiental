"use client";
import dynamic from "next/dynamic";

/** Carrega o TipTap só no navegador (ssr: false precisa de componente cliente). */
const EditorTexto = dynamic(() => import("./editor-texto"), {
  ssr: false,
  loading: () => <div className="card p-6 text-sm text-slate-600" role="status">Carregando o editor…</div>,
});

export function EditorCarregador(props: { documentoId: string; htmlInicial: string; atualizadoEm: string | null }) {
  return <EditorTexto {...props} />;
}
