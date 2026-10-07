"use client";
// Lista de abas acessível (WAI-ARIA tablist com ativação manual): setas/Home/End movem o foco, Enter/clique navega (?aba=).
import clsx from "clsx";
import Link from "next/link";
import { useRef } from "react";

export type ItemAba = { id: string; rotulo: string; href: string };

export function AbasDocumento({ abas, atual, rotulo = "Seções do documento" }: { abas: ItemAba[]; atual: string; rotulo?: string }) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const mover = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % abas.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + abas.length) % abas.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = abas.length - 1;
    else return;
    e.preventDefault();
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={rotulo} className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {abas.map((a, i) => {
        const ativa = a.id === atual;
        return (
          <Link
            key={a.id}
            ref={(el) => { refs.current[i] = el; }}
            id={`aba-${a.id}`}
            role="tab"
            aria-selected={ativa}
            aria-controls="painel-aba"
            tabIndex={ativa ? 0 : -1}
            href={a.href}
            prefetch={false}
            scroll={false}
            onKeyDown={(e) => mover(e, i)}
            className={clsx(
              "-mb-px whitespace-nowrap rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primaria-600",
              ativa ? "border-slate-200 bg-white text-primaria-800" : "border-transparent text-slate-600 hover:bg-slate-100",
            )}
          >
            {a.rotulo}
          </Link>
        );
      })}
    </div>
  );
}
