"use client";
import { useEffect, useState } from "react";
import L from "leaflet";
import type { ConfigMapas } from "@/lib/geo/config";

export type { ConfigMapas };

// Configuração dos mapas (chave Google lida no servidor em runtime, órgão ativo, UF) – 1 requisição por página.
let promessa: Promise<ConfigMapas | null> | null = null;

export function carregarConfigMapas(): Promise<ConfigMapas | null> {
  if (!promessa) {
    promessa = fetch("/api/v1/mapas/config", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ConfigMapas>) : null))
      .catch(() => null);
  }
  return promessa;
}

/** `ativo=false` (mapa público) não consulta nada. */
export function useConfigMapas(ativo: boolean): ConfigMapas | null {
  const [cfg, setCfg] = useState<ConfigMapas | null>(null);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    carregarConfigMapas().then((c) => vivo && setCfg(c));
    return () => {
      vivo = false;
    };
  }, [ativo]);
  return cfg;
}

/** Plugins Leaflet "clássicos" (GoogleMutant, Geoman) usam o global `L`, que o bundler não define. */
export function garantirLGlobal() {
  const w = window as unknown as { L?: typeof L };
  if (!w.L) w.L = L;
}

// ── Preferências (localStorage pode falhar: aba privada, bloqueio de cookies…) ──
export function lerPreferencia(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}
export function salvarPreferencia(chave: string, valor: string | null) {
  try {
    if (valor) window.localStorage.setItem(chave, valor);
    else window.localStorage.removeItem(chave);
  } catch {
    /* ignora */
  }
}
