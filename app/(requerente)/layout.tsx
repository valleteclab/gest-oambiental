import Link from "next/link";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { isInterno } from "@/lib/rbac";
import { SinoAlertas } from "@/components/sino-alertas";
import { FaixaDemo, OrgaoAtivo } from "@/components/orgao";

export default async function LayoutRequerente({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario();
  const orgao = await getOrgaoAtivo();
  return (
    <div className="min-h-screen">
      <FaixaDemo />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/meus-processos" className="text-lg font-bold text-primaria-800">LicenciaGov</Link>
          <OrgaoAtivo orgao={orgao} />
          <nav className="flex gap-3 text-sm" aria-label="Menu do requerente">
            <Link href="/meus-processos" className="hover:underline">Meus processos</Link>
            <Link href="/novo-requerimento" className="hover:underline">Novo requerimento</Link>
            {isInterno(usuario) && <Link href="/dashboard" className="hover:underline">Painel interno</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SinoAlertas usuarioId={usuario.id} />
            <span className="hidden text-sm sm:inline" data-testid="usuario-nome">{usuario.nome}</span>
            <Link href="/sair" prefetch={false} className="btn-secundario btn-sm">Sair</Link>
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
