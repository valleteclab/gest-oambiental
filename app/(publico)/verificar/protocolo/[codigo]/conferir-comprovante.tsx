"use client";
import { useState } from "react";

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** O navegador calcula o SHA-256 do PDF escolhido (WebCrypto, nada é enviado) e compara com o do comprovante registrado. */
export function ConferirComprovante({ sha256 }: { sha256: string | null }) {
  const [res, setRes] = useState<{ ok: boolean; hash: string; nome: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setRes(null);
    setErro(null);
    if (!f || !sha256) return;
    if (!globalThis.crypto?.subtle) { setErro("Seu navegador não permite calcular o hash nesta página (é necessário HTTPS)."); return; }
    try {
      const h = hex(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()));
      setRes({ ok: h === sha256.toLowerCase(), hash: h, nome: f.name });
    } catch {
      setErro("Não foi possível ler o arquivo.");
    }
  }
  return (
    <div>
      <label htmlFor="arquivo-conferir" className="label">Conferir o PDF do comprovante que você recebeu</label>
      <input id="arquivo-conferir" type="file" accept="application/pdf,.pdf" onChange={aoEscolher} className="input" disabled={!sha256} aria-describedby="arquivo-conferir-dica" />
      <p id="arquivo-conferir-dica" className="mt-1 text-xs text-slate-500">O arquivo é verificado no seu próprio navegador e não é enviado ao servidor.</p>
      <div aria-live="polite" className="mt-3 text-sm">
        {erro && <p className="text-red-700">{erro}</p>}
        {res?.ok && <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900" data-testid="resultado-conferencia" data-resultado="IGUAL"><strong>Arquivo íntegro:</strong> “{res.nome}” é idêntico ao comprovante registrado.</p>}
        {res && !res.ok && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900" data-testid="resultado-conferencia" data-resultado="DIFERENTE">
            <strong>FALHA: arquivo diferente do registrado.</strong> O PDF “{res.nome}” foi alterado ou não é o comprovante deste protocolo.
            <span className="mt-1 block break-all font-mono text-xs">SHA-256 calculado: {res.hash}</span>
          </p>
        )}
      </div>
    </div>
  );
}
