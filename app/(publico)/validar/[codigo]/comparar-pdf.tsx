"use client";
import { useState } from "react";

/** Compara o SHA-256 de um PDF escolhido pelo cidadão com o hash registrado (cálculo local, o arquivo não é enviado). */
export function CompararPdf({ hashEsperado }: { hashEsperado: string }) {
  const [res, setRes] = useState<null | { ok: boolean; hash: string; nome: string }>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setRes(null);
    setErro(null);
    if (!f) return;
    if (!globalThis.crypto?.subtle) {
      setErro("Seu navegador não permite calcular o hash nesta página (é necessário HTTPS).");
      return;
    }
    setCalculando(true);
    try {
      const buf = await f.arrayBuffer();
      const dig = await crypto.subtle.digest("SHA-256", buf);
      const hash = Array.from(new Uint8Array(dig), (b) => b.toString(16).padStart(2, "0")).join("");
      setRes({ ok: hash === hashEsperado.toLowerCase(), hash, nome: f.name });
    } catch {
      setErro("Não foi possível ler o arquivo.");
    } finally {
      setCalculando(false);
    }
  }

  return (
    <div>
      <label htmlFor="pdf-comparar" className="label">Conferir um arquivo PDF que você recebeu</label>
      <input id="pdf-comparar" type="file" accept="application/pdf,.pdf" onChange={aoEscolher} className="input" aria-describedby="pdf-comparar-dica" />
      <p id="pdf-comparar-dica" className="mt-1 text-xs text-slate-500">O arquivo é verificado no seu próprio navegador e não é enviado ao servidor.</p>
      <div aria-live="polite" className="mt-3 text-sm">
        {calculando && <p>Calculando…</p>}
        {erro && <p className="text-red-700">{erro}</p>}
        {res &&
          (res.ok ? (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900" data-testid="resultado-hash">
              <strong>Arquivo íntegro:</strong> “{res.nome}” é idêntico ao documento original registrado.
            </p>
          ) : (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900" data-testid="resultado-hash">
              <strong>Arquivo diferente do original.</strong> O PDF “{res.nome}” foi alterado ou não corresponde a este documento.
              <span className="mt-1 block break-all font-mono text-xs">SHA-256 calculado: {res.hash}</span>
            </p>
          ))}
      </div>
    </div>
  );
}
