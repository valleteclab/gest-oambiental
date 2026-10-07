import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FaixaDemo, LogoOrganizacao } from "@/components/orgao";
import { logoProprio } from "@/lib/imagem";
import { carregarPortalCache } from "@/lib/ged/protocolo/publico";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Protocolo online", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Portal PÚBLICO do órgão (sem login). Slug inexistente OU portal desligado = 404 (indistinguíveis).
export default async function LayoutProtocoloPublico({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const portal = await carregarPortalCache(slug);
  if (!portal) notFound();
  const logo = logoProprio(portal.organizacao.logo_url);
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <FaixaDemo />
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <header className="border-b border-primaria-900/20 bg-primaria-800 text-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          {logo && <span className="rounded bg-white p-1"><LogoOrganizacao src={logo} nome={portal.organizacao.nome} className="h-8 w-auto max-w-[140px] object-contain" /></span>}
          <div className="min-w-0">
            <div className="truncate text-lg font-bold tracking-tight" data-testid="portal-orgao">{portal.organizacao.nome}</div>
            <div className="text-xs text-emerald-100">Protocolo online</div>
          </div>
          <nav className="ml-auto flex gap-4 text-sm" aria-label="Protocolo online">
            <Link href={`/protocolo/${slug}`} prefetch={false} className="hover:underline">Protocolar</Link>
            <Link href={`/protocolo/${slug}/consulta`} prefetch={false} className="hover:underline">Acompanhar</Link>
          </nav>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">{children}</main>
      <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
        Os dados informados são tratados apenas para registrar e responder ao protocolo (LGPD – Lei nº 13.709/2018).
      </footer>
    </div>
  );
}
