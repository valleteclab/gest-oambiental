import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizarCodigo } from "@/lib/documentos/render";
import { Aviso } from "@/components/ui";

export const metadata: Metadata = { title: "Validar documento" };

export default async function ValidarPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const { codigo } = await searchParams;
  const normal = codigo ? normalizarCodigo(codigo) : null;
  if (normal) redirect(`/validar/${normal}`);
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="titulo-pagina">Validar documento oficial</h1>
      <p className="mt-2 text-sm text-slate-600">
        Confira a autenticidade de licenças, autorizações, certidões, autos de infração, notificações e demais documentos emitidos pelos órgãos ambientais municipais.
        Informe o <strong>código verificador</strong> impresso no rodapé do documento ou leia o QR Code com a câmera do celular.
      </p>
      {codigo && !normal && (
        <div className="mt-4">
          <Aviso tipo="erro">Código inválido. O código tem 12 caracteres (letras e números), no formato XXXX-XXXX-XXXX.</Aviso>
        </div>
      )}
      <form method="get" action="/validar" className="card mt-6 space-y-4 p-5">
        <label className="block" htmlFor="codigo">
          <span className="label">Código verificador</span>
          <input
            id="codigo"
            name="codigo"
            required
            defaultValue={codigo ?? ""}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={20}
            placeholder="Ex.: 7KQ2-M9XA-D3PL"
            className="input font-mono text-lg uppercase tracking-widest"
            aria-describedby="codigo-dica"
          />
          <span id="codigo-dica" className="mt-1 block text-xs text-slate-500">Os hífens são opcionais. Não há as letras O e I nem os números 0 e 1.</span>
        </label>
        <button type="submit" className="btn-primario w-full sm:w-auto">Validar</button>
      </form>
    </div>
  );
}
