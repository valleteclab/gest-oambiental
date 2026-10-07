"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type ItemNavGed = { href: string; rotulo: string };

/** Links do menu (cliente, para marcar a página atual com aria-current). */
export function NavGedLinks({ itens }: { itens: ItemNavGed[] }) {
  const path = usePathname();
  return (
    <ul className="flex flex-wrap gap-1">
      {itens.map((i) => {
        const ativo = i.href === "/ged" ? path === "/ged" : path === i.href || path.startsWith(`${i.href}/`);
        return (
          <li key={i.href}>
            <Link
              href={i.href}
              prefetch={false}
              aria-current={ativo ? "page" : undefined}
              className={clsx("block rounded-md px-3 py-2 text-sm font-medium", ativo ? "bg-white text-primaria-800" : "text-emerald-50 hover:bg-primaria-700")}
            >
              {i.rotulo}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
