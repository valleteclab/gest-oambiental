"use client";
import { useState } from "react";

/** Encerra a sessão do destinatário (apaga o cookie e invalida a sessão no servidor) e volta à tela do código. */
export function BotaoSair({ token }: { token: string }) {
  const [saindo, setSaindo] = useState(false);
  return (
    <button
      type="button" className="btn-secundario btn-sm" disabled={saindo} data-testid="sair-compartilhado"
      onClick={async () => {
        setSaindo(true);
        await fetch(`/api/v1/publico/compartilhado/${token}/sair`, { method: "POST" }).catch(() => undefined);
        window.location.reload();
      }}
    >
      {saindo ? "Saindo…" : "Sair"}
    </button>
  );
}
