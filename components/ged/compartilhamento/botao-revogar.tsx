"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Aviso } from "@/components/ui";

/** Revoga o link (efeito imediato, inclusive sessões abertas) e recarrega a tela. */
export function BotaoRevogar({ id, rotulo = "Revogar link" }: { id: string; rotulo?: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button" className="btn-perigo btn-sm" disabled={ocupado} data-testid={`revogar-${id}`}
        onClick={async () => {
          if (!window.confirm("Revogar este link agora? Quem estiver com o documento aberto perderá o acesso imediatamente.")) return;
          setOcupado(true);
          setErro("");
          try {
            const r = await fetch(`/api/v1/ged/compartilhamentos/${id}/revogar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            if (!r.ok) setErro("Não foi possível revogar. Tente de novo.");
            else router.refresh();
          } catch {
            setErro("Falha de conexão.");
          } finally {
            setOcupado(false);
          }
        }}
      >
        {ocupado ? "Revogando…" : rotulo}
      </button>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </span>
  );
}
