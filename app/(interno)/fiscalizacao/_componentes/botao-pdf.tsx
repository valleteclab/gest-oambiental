"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { erroDaResposta } from "@/lib/fiscalizacao/cliente";

/** Link para o PDF emitido ou botão "Gerar PDF novamente" quando a emissão falhou. */
export function BotaoPdf({ tipo, id, documentoId, podeEmitir }: { tipo: "autos-infracao" | "notificacoes"; id: string; documentoId: string | null; podeEmitir: boolean }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (documentoId)
    return <a href={`/api/v1/documentos/${documentoId}/pdf`} target="_blank" rel="noopener" className="btn-secundario btn-sm" data-testid="link-pdf">📄 PDF</a>;
  if (!podeEmitir) return <span className="text-xs text-amber-700">PDF pendente</span>;
  async function gerar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/v1/${tipo}/${id}/pdf`, { method: "POST" });
      if (!r.ok) throw new Error(await erroDaResposta(r).then((m) => m || "Falha ao gerar PDF."));
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={gerar} disabled={carregando} className="btn-sm btn-secundario border-amber-400" data-testid="gerar-pdf-novamente">
        {carregando ? "Gerando…" : "Gerar PDF novamente"}
      </button>
      {erro && <span className="text-xs text-red-700" role="alert">{erro}</span>}
    </span>
  );
}
