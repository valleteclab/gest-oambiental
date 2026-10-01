import Link from "next/link";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { ROTULO_PAPEL } from "@/lib/rbac";
import { NavInterno } from "@/components/nav-interno";
import { SinoAlertas } from "@/components/sino-alertas";
import { FaixaDemo, OrgaoAtivo } from "@/components/orgao";

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario({ interno: true });
  const orgao = await getOrgaoAtivo();
  const papeis = [...new Set(usuario.papeis.map((p) => ROTULO_PAPEL[p.papel]))].join(", ");
  return (
    <>
    <FaixaDemo />
    <div className="min-h-screen lg:flex">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <aside className="bg-primaria-800 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        {/* Celular: menu recolhido por padrão */}
        <details className="lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-white">
            <span className="text-lg font-bold tracking-tight">LicenciaGov</span>
            <span className="text-sm text-emerald-200">Menu ▾</span>
          </summary>
          <div className="px-2 pb-4"><NavInterno usuario={usuario} /></div>
        </details>
        {/* Desktop: menu lateral fixo */}
        <div className="hidden lg:block">
          <Link href="/dashboard" className="block px-4 py-4 text-lg font-bold tracking-tight text-white">LicenciaGov</Link>
          <div className="px-2 pb-4"><NavInterno usuario={usuario} /></div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
          <OrgaoAtivo orgao={orgao} />
          <form action="/busca" className="order-last basis-full sm:order-none sm:basis-auto sm:flex-1" role="search">
            <label htmlFor="busca-global" className="sr-only">Busca global</label>
            <input id="busca-global" name="q" className="input max-w-md" placeholder="Buscar nº de processo, CPF/CNPJ, nome, empreendimento…" />
          </form>
          <div className="ml-auto sm:ml-0"><SinoAlertas usuarioId={usuario.id} /></div>
          <div className="hidden text-right text-xs sm:block">
            <div className="font-medium text-slate-800" data-testid="usuario-nome">{usuario.nome}</div>
            <div className="text-slate-500">{papeis}</div>
          </div>
          <Link href="/trocar-senha" prefetch={false} className="text-xs text-slate-600 underline hover:text-slate-900">Alterar senha</Link>
          <Link href="/sair" prefetch={false} className="btn-secundario btn-sm">Sair</Link>
        </header>
        <main id="conteudo" className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
    </>
  );
}
