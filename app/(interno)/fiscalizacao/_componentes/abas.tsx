import Link from "next/link";
import clsx from "clsx";

const ABAS = [
  { href: "/fiscalizacao", rotulo: "Vistorias" },
  { href: "/fiscalizacao/denuncias", rotulo: "Denúncias" },
  { href: "/fiscalizacao/autos", rotulo: "Autos de infração" },
  { href: "/fiscalizacao/notificacoes", rotulo: "Notificações" },
  { href: "/fiscalizacao/mapa", rotulo: "Mapa" },
];

export function AbasFiscalizacao({ ativa }: { ativa: string }) {
  return (
    <nav aria-label="Seções da fiscalização" className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-slate-200">
        {ABAS.map((a) => (
          <li key={a.href}>
            <Link href={a.href} aria-current={ativa === a.href ? "page" : undefined}
              className={clsx("inline-block border-b-2 px-3 py-2 text-sm font-medium", ativa === a.href ? "border-primaria-700 text-primaria-800" : "border-transparent text-slate-600 hover:text-slate-900")}>
              {a.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
