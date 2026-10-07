import Link from "next/link";
import { FaixaDemo, LogoOrganizacao } from "@/components/orgao";
import { NavGed } from "@/components/ged/nav-ged";
import { exigirGed } from "@/lib/ged/escopo";
import { logoProprio } from "@/lib/imagem";
import { NOME_MODULO_GED, ROTULO_PAPEL_GED } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";

export default async function LayoutGed({ children }: { children: React.ReactNode }) {
  const ctx = await exigirGed();
  const logo = logoProprio(ctx.organizacao.logo_url);
  return (
    <>
      <FaixaDemo />
      <div className="min-h-screen">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
        <header className="bg-primaria-800 text-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/ged" className="text-lg font-bold tracking-tight">{NOME_MODULO_GED}</Link>
            <div className="flex min-w-0 items-center gap-2 text-sm text-emerald-100" data-testid="ged-organizacao">
              {logo && <span className="rounded bg-white p-1"><LogoOrganizacao src={logo} nome={ctx.organizacao.nome} className="h-6 w-auto max-w-[120px] object-contain" /></span>}
              <span className="truncate">{ctx.organizacao.nome}</span>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
              <div className="text-right leading-tight">
                <div className="font-medium" data-testid="usuario-nome">{ctx.usuario.nome}</div>
                <div className="text-xs text-emerald-200">{ROTULO_PAPEL_GED[ctx.membro.papel]}</div>
              </div>
              <Link href="/trocar-senha" prefetch={false} className="text-xs underline hover:text-white">Alterar senha</Link>
              <Link href="/sair" prefetch={false} className="btn-secundario btn-sm">Sair</Link>
            </div>
          </div>
          <div className="mx-auto max-w-7xl px-2 pb-2"><NavGed ctx={ctx} /></div>
        </header>
        <main id="conteudo" className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </>
  );
}
