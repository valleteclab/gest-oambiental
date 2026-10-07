import Link from "next/link";
import { exigirOperador } from "@/lib/plataforma/operador";
import { encerrarPlataformaAcao } from "./actions";

// Painel do operador da plataforma. A verificação de operador roda aqui E em cada página/ação (layouts não são reexecutados
// em toda navegação): quem não é operador recebe 404. Nunca indexar.
export const dynamic = "force-dynamic";
export const metadata = { title: "Plataforma", robots: { index: false, follow: false } };

export default async function LayoutPlataforma({ children }: { children: React.ReactNode }) {
  const operador = await exigirOperador();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/plataforma" className="text-lg font-bold tracking-tight">Plataforma</Link>
          <nav className="flex gap-3 text-sm" aria-label="Menu da plataforma">
            <Link href="/plataforma" className="hover:underline">Clientes</Link>
            <Link href="/plataforma/novo" className="hover:underline">Novo cliente</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span data-testid="usuario-nome" className="hidden sm:inline">{operador.nome}</span>
            <form action={encerrarPlataformaAcao}><button className="text-xs underline hover:text-slate-300" type="submit">Bloquear painel</button></form>
            <Link href="/sair" prefetch={false} className="btn-secundario btn-sm">Sair</Link>
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
