import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizarCodigoGed } from "@/lib/ged/assinaturas/regras";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verificar documento assinado", robots: { index: false, follow: false } };

async function ir(f: FormData) {
  "use server";
  const bruto = String(f.get("codigo") ?? "");
  const c = normalizarCodigoGed(bruto);
  redirect(c ? `/verificar/${c}` : `/verificar/${encodeURIComponent(bruto.slice(0, 40)) || "invalido"}`);
}

export default function VerificarIndice() {
  return (
    <div className="space-y-4">
      <h1 className="titulo-pagina">Verificar documento assinado</h1>
      <p className="text-sm text-slate-600">Informe o código verificador impresso no rodapé do documento (ou leia o QR Code) para conferir a autenticidade, os signatários e a integridade do arquivo.</p>
      <form action={ir} className="card space-y-3 p-4">
        <div>
          <label htmlFor="codigo" className="label">Código verificador</label>
          <input id="codigo" name="codigo" className="input font-mono uppercase" placeholder="XXXX-XXXX-XXXX" autoComplete="off" required maxLength={40} />
        </div>
        <button className="btn-primario">Verificar</button>
      </form>
    </div>
  );
}
