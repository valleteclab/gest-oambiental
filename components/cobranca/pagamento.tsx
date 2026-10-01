"use client";
import { useState } from "react";

/** Botão "Copiar" (Pix copia e cola / linha digitável) com retorno acessível. */
export function BotaoCopiar({ texto, rotulo, testid }: { texto: string; rotulo: string; testid?: string }) {
  const [ok, setOk] = useState<boolean | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-secundario btn-sm"
        data-testid={testid}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(texto);
            setOk(true);
          } catch {
            setOk(false);
          }
        }}
      >
        {rotulo}
      </button>
      <span role="status" className="text-xs text-slate-600">{ok === true ? "Copiado!" : ok === false ? "Selecione e copie o código manualmente." : ""}</span>
    </span>
  );
}
