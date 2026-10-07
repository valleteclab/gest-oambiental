"use client";
// Árvore de pastas (WAI-ARIA tree): expandir/recolher com mouse ou teclado.
//   ↑/↓ move entre itens visíveis · → expande (ou vai ao primeiro filho) · ← recolhe (ou vai ao pai) · Home/End · Enter abre a pasta.
// Cada item é um link para /ged/pastas?pasta=<id> (o servidor mostra o painel da pasta selecionada).
import clsx from "clsx";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { NoArvore } from "@/lib/ged/pastas";

type Visivel = { no: NoArvore; nivel: number; pai: string | null };

function achatar(nos: NoArvore[], abertos: Set<string>, nivel = 1, pai: string | null = null): Visivel[] {
  return nos.flatMap((n) => [{ no: n, nivel, pai }, ...(n.filhas.length && abertos.has(n.id) ? achatar(n.filhas, abertos, nivel + 1, n.id) : [])]);
}

function idsComAncestrais(nos: NoArvore[], alvo: string | null): Set<string> {
  const abertos = new Set<string>();
  if (!alvo) return abertos;
  const visita = (l: NoArvore[], trilha: string[]): boolean => {
    for (const n of l) {
      if (n.id === alvo) { trilha.forEach((t) => abertos.add(t)); return true; }
      if (visita(n.filhas, [...trilha, n.id])) return true;
    }
    return false;
  };
  visita(nos, []);
  return abertos;
}

export function ArvorePastas({ arvore, selecionada, hrefBase = "/ged/pastas" }: { arvore: NoArvore[]; selecionada: string | null; hrefBase?: string }) {
  const [abertos, setAbertos] = useState<Set<string>>(() => idsComAncestrais(arvore, selecionada));
  const [foco, setFoco] = useState<string | null>(selecionada ?? arvore[0]?.id ?? null);
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const visiveis = useMemo(() => achatar(arvore, abertos), [arvore, abertos]);
  const focoEfetivo = visiveis.some((v) => v.no.id === foco) ? foco : (visiveis[0]?.no.id ?? null);
  const alternar = (id: string, abrir?: boolean) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (abrir ?? !n.has(id)) n.add(id); else n.delete(id);
      return n;
    });
  const ir = (id: string | undefined) => {
    if (!id) return;
    setFoco(id);
    refs.current.get(id)?.focus();
  };

  const tecla = (e: React.KeyboardEvent, v: Visivel) => {
    const i = visiveis.findIndex((x) => x.no.id === v.no.id);
    const tem = v.no.filhas.length > 0;
    const aberto = abertos.has(v.no.id);
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); ir(visiveis[i + 1]?.no.id); break;
      case "ArrowUp": e.preventDefault(); ir(visiveis[i - 1]?.no.id); break;
      case "Home": e.preventDefault(); ir(visiveis[0]?.no.id); break;
      case "End": e.preventDefault(); ir(visiveis[visiveis.length - 1]?.no.id); break;
      case "ArrowRight":
        e.preventDefault();
        if (tem && !aberto) alternar(v.no.id, true);
        else if (tem) ir(visiveis[i + 1]?.no.id);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (tem && aberto) alternar(v.no.id, false);
        else if (v.pai) ir(v.pai);
        break;
    }
  };

  if (arvore.length === 0) return <p className="text-sm text-slate-600">Nenhuma pasta disponível para você.</p>;
  const lista = (nos: NoArvore[], nivel: number) => (
    <ul role={nivel === 1 ? "tree" : "group"} aria-label={nivel === 1 ? "Pastas" : undefined} className={nivel > 1 ? "ml-4 border-l border-slate-200 pl-2" : undefined}>
      {nos.map((n) => {
        const tem = n.filhas.length > 0;
        const aberto = abertos.has(n.id);
        const sel = n.id === selecionada;
        const v = visiveis.find((x) => x.no.id === n.id)!;
        return (
          <li key={n.id} role="treeitem" aria-expanded={tem ? aberto : undefined} aria-selected={sel} aria-level={nivel}>
            <div className={clsx("flex items-center gap-1 rounded-md", sel && "bg-primaria-100")}>
              {tem ? (
                <button type="button" tabIndex={-1} aria-label={`${aberto ? "Recolher" : "Expandir"} ${n.nome}`} onClick={() => alternar(n.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-200">
                  <span aria-hidden className={clsx("inline-block transition-transform", aberto && "rotate-90")}>▸</span>
                </button>
              ) : <span className="inline-block w-7 shrink-0" aria-hidden />}
              <Link
                ref={(el) => { if (el) refs.current.set(n.id, el); else refs.current.delete(n.id); }}
                href={`${hrefBase}?pasta=${n.id}`}
                prefetch={false}
                tabIndex={focoEfetivo === n.id ? 0 : -1}
                aria-current={sel ? "page" : undefined}
                onFocus={() => setFoco(n.id)}
                onKeyDown={(e) => tecla(e, v)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primaria-600"
              >
                <span className="truncate">{n.nome}</span>
                <span className="shrink-0 text-xs text-slate-500" aria-label={`${n.documentos} documentos`}>{n.documentos}</span>
              </Link>
            </div>
            {tem && aberto && lista(n.filhas, nivel + 1)}
          </li>
        );
      })}
    </ul>
  );
  return lista(arvore, 1);
}
