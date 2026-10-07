"use client";
import { useState } from "react";

type Resultado = { tipo: "SELADO" | "ORIGINAL" | "DIFERENTE"; hash: string; nome: string };

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * "Conferir arquivo": o navegador calcula o SHA-256 do PDF escolhido (WebCrypto, sem enviar nada ao servidor) e compara com
 * o hash do arquivo SELADO e com o do ORIGINAL enviado para assinatura. Qualquer byte alterado → "diferente".
 */
export function ConferirArquivo({ sha256Final, sha256Alvo }: { sha256Final: string | null; sha256Alvo: string }) {
  const [res, setRes] = useState<Resultado | null>(null);
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
      const h = hex(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()));
      const tipo = sha256Final && h === sha256Final.toLowerCase() ? "SELADO" : h === sha256Alvo.toLowerCase() ? "ORIGINAL" : "DIFERENTE";
      setRes({ tipo, hash: h, nome: f.name });
    } catch {
      setErro("Não foi possível ler o arquivo.");
    } finally {
      setCalculando(false);
    }
  }

  return (
    <div>
      <label htmlFor="arquivo-conferir" className="label">Conferir um arquivo PDF que você recebeu</label>
      <input id="arquivo-conferir" type="file" accept="application/pdf,.pdf" onChange={aoEscolher} className="input" aria-describedby="arquivo-conferir-dica" />
      <p id="arquivo-conferir-dica" className="mt-1 text-xs text-slate-500">O arquivo é verificado no seu próprio navegador e não é enviado ao servidor.</p>
      <div aria-live="polite" className="mt-3 text-sm">
        {calculando && <p>Calculando…</p>}
        {erro && <p className="text-red-700">{erro}</p>}
        {res?.tipo === "SELADO" && (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900" data-testid="resultado-conferencia" data-resultado="SELADO">
            <strong>Arquivo íntegro:</strong> “{res.nome}” é idêntico ao documento selado registrado.
          </p>
        )}
        {res?.tipo === "ORIGINAL" && (
          <p className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-900" data-testid="resultado-conferencia" data-resultado="ORIGINAL">
            <strong>Este é o arquivo original, sem o selo:</strong> “{res.nome}” é idêntico ao que foi enviado para assinatura. Para a versão com QR Code e folha de assinaturas, use o arquivo selado.
          </p>
        )}
        {res?.tipo === "DIFERENTE" && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900" data-testid="resultado-conferencia" data-resultado="DIFERENTE">
            <strong>FALHA: arquivo diferente do registrado.</strong> O PDF “{res.nome}” foi alterado ou não corresponde a este documento.
            <span className="mt-1 block break-all font-mono text-xs">SHA-256 calculado: {res.hash}</span>
          </p>
        )}
      </div>
    </div>
  );
}
