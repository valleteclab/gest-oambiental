"use client";
import dynamic from "next/dynamic";
import type { PropsMapa } from "./mapa-leaflet";

// Leaflet usa `window` – carregar só no cliente.
export const Mapa = dynamic<PropsMapa>(() => import("./mapa-leaflet"), {
  ssr: false,
  loading: () => <div className="flex h-[300px] items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-sm text-slate-500">Carregando mapa…</div>,
});
export type { PontoMapa, PropsMapa } from "./mapa-leaflet";
