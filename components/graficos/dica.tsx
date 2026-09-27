"use client";
import { TINTA } from "./paleta";

type Item = { name?: string | number; value?: unknown; color?: string; fill?: string; dataKey?: string | number; payload?: Record<string, unknown> };

/** Tooltip: valor em destaque, rótulo secundário, chave de série em traço. */
export function Dica({ active, payload, label, formatar }: { active?: boolean; payload?: readonly Item[]; label?: string | number; formatar?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const f = formatar ?? ((v: number) => v.toLocaleString("pt-BR"));
  const itens = payload.filter((p) => Number(p.value) > 0 || payload.length === 1);
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      {label !== undefined && <div className="mb-1 font-medium" style={{ color: TINTA.secundaria }}>{String(label)}</div>}
      <ul className="space-y-0.5">
        {itens.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            {payload.length > 1 && <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: p.color ?? p.fill }} />}
            <span className="font-semibold tabular-nums" style={{ color: TINTA.primaria }}>{f(Number(p.value))}</span>
            {payload.length > 1 && <span style={{ color: TINTA.secundaria }}>{String(p.name)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
