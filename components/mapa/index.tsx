"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { PropsMapa } from "./mapa-leaflet";
import type { PropsComparar } from "./comparar-leaflet";

const Carregando = ({ altura = 300 }: { altura?: number }) => (
  <div className="flex items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-sm text-slate-500" style={{ height: altura }}>Carregando mapa…</div>
);

// Leaflet usa `window` – carregar só no cliente.
export const Mapa = dynamic<PropsMapa>(() => import("./mapa-leaflet"), { ssr: false, loading: () => <Carregando /> });

const CompararLeaflet = dynamic<PropsComparar>(() => import("./comparar-leaflet"), { ssr: false, loading: () => <Carregando altura={420} /> });

/** Botão "Comparar imagens (antes/depois)" que abre dois mapas sincronizados com o histórico Esri Wayback. */
export function CompararImagens(props: PropsComparar) {
  const [aberto, setAberto] = useState(false);
  return (
    <div>
      <button type="button" className="btn-secundario btn-sm" aria-expanded={aberto} onClick={() => setAberto((a) => !a)} data-testid="abrir-comparar">
        {aberto ? "Fechar comparação" : "Comparar imagens (antes/depois)"}
      </button>
      {aberto && <div className="mt-3"><CompararLeaflet {...props} /></div>}
    </div>
  );
}

export type { FeicaoMapa, PontoMapa, PropsMapa } from "./mapa-leaflet";
export type { PropsComparar } from "./comparar-leaflet";
export type { PoligonoGeo } from "@/lib/geo/validar";
