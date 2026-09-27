import Link from "next/link";

export default function LayoutPublico({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-primaria-800 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold">LicenciaGov</Link>
          <nav className="flex flex-wrap gap-4 text-sm" aria-label="Portal público">
            <Link href="/consulta" className="hover:underline">Consultar processo</Link>
            <Link href="/licencas" className="hover:underline">Licenças emitidas</Link>
            <Link href="/validar" className="hover:underline">Validar documento</Link>
            <Link href="/denuncia" className="hover:underline">Fazer denúncia</Link>
          </nav>
          <Link href="/login" className="ml-auto rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Entrar</Link>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      <footer className="border-t border-slate-200 bg-white text-sm text-slate-600">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4 py-4">
          <span>CDS Piemonte do Paraguaçu · Programa GAC</span>
          <Link href="/privacidade" className="hover:underline">Política de privacidade</Link>
          <Link href="/termos" className="hover:underline">Termo de uso</Link>
        </div>
      </footer>
    </div>
  );
}
