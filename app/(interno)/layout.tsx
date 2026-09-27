import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { ROTULO_PAPEL } from "@/lib/rbac";
import { NavInterno } from "@/components/nav-interno";
import { SinoAlertas } from "@/components/sino-alertas";

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario({ interno: true });
  const papeis = [...new Set(usuario.papeis.map((p) => ROTULO_PAPEL[p.papel]))].join(", ");
  return (
    <div className="min-h-screen lg:flex">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <aside className="bg-primaria-800 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        <details className="group lg:open" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-white lg:cursor-default">
            <Link href="/dashboard" className="text-lg font-bold tracking-tight">LicenciaGov</Link>
            <span className="text-xs text-emerald-200 lg:hidden">Menu ▾</span>
          </summary>
          <div className="px-2 pb-4"><NavInterno usuario={usuario} /></div>
        </details>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
          <form action="/busca" className="flex-1" role="search">
            <label htmlFor="busca-global" className="sr-only">Busca global</label>
            <input id="busca-global" name="q" className="input max-w-md" placeholder="Buscar nº de processo, CPF/CNPJ, nome, empreendimento…" />
          </form>
          <SinoAlertas usuarioId={usuario.id} />
          <div className="hidden text-right text-xs sm:block">
            <div className="font-medium text-slate-800" data-testid="usuario-nome">{usuario.nome}</div>
            <div className="text-slate-500">{papeis}</div>
          </div>
          <Link href="/sair" prefetch={false} className="btn-secundario btn-sm">Sair</Link>
        </header>
        <main id="conteudo" className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
