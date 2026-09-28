import Link from "next/link";
import { Leaf } from "lucide-react";
import { FaixaDemo } from "@/components/orgao";
import { CONTATO_COMERCIAL } from "@/lib/site";

export default function LayoutPublico({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900">Pular para o conteúdo</a>
      <FaixaDemo />
      <header className="border-b border-primaria-900/20 bg-primaria-800 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/15" aria-hidden><Leaf className="h-5 w-5" /></span>
            LicenciaGov
          </Link>
          <nav className="order-last flex w-full flex-wrap gap-x-4 gap-y-1 text-sm text-emerald-50 md:order-none md:w-auto" aria-label="Portal público">
            <Link href="/consulta" className="rounded hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white">Consultar processo</Link>
            <Link href="/licencas" className="rounded hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white">Licenças emitidas</Link>
            <Link href="/validar" className="rounded hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white">Validar documento</Link>
            <Link href="/servicos" className="rounded hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white">Serviços</Link>
            <Link href="/denuncia" className="rounded hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white">Fazer denúncia</Link>
          </nav>
          <Link href="/login" className="ml-auto rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-primaria-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Entrar</Link>
        </div>
      </header>
      <main id="conteudo" className="flex-1 bg-slate-50">{children}</main>
      <footer className="border-t border-slate-200 bg-white text-sm text-slate-600">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p><strong className="text-slate-800">LicenciaGov</strong> · plataforma de licenciamento e fiscalização ambiental · VALLETECLAB</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Rodapé">
            <Link href="/privacidade" className="hover:text-slate-900 hover:underline">Política de privacidade</Link>
            <Link href="/termos" className="hover:text-slate-900 hover:underline">Termo de uso</Link>
            <a href={`mailto:${CONTATO_COMERCIAL}`} className="hover:text-slate-900 hover:underline">{CONTATO_COMERCIAL}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
