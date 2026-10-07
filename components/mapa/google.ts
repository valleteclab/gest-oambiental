"use client";
// Caminho ESM explícito: o campo "browser" do pacote aponta para o build UMD (sem export).
import type GoogleMutantT from "leaflet.gridlayer.googlemutant/src/Leaflet.GoogleMutant.mjs";
import { garantirLGlobal } from "./config-cliente";

// Carrega (uma vez por página) a Maps JavaScript API com a chave vinda do servidor e o plugin GoogleMutant.
// Com loading=async a API só está pronta quando o callback é chamado.

type JanelaGoogle = Window & { google?: { maps?: { Map?: unknown } }; __lgGooglePronto?: () => void; gm_authFailure?: () => void };

let carregando: Promise<typeof GoogleMutantT> | null = null;
const ouvintesFalha = new Set<() => void>();
let chaveFalhou = false;

export function googleFalhou() {
  return chaveFalhou;
}

/** Registra um callback para quando o Google recusar a chave (domínio não autorizado, faturamento etc.). */
export function aoFalharChaveGoogle(fn: () => void): () => void {
  ouvintesFalha.add(fn);
  return () => ouvintesFalha.delete(fn);
}

export function carregarGoogleMutant(chave: string): Promise<typeof GoogleMutantT> {
  if (carregando) return carregando;
  const w = window as JanelaGoogle;
  w.gm_authFailure = () => {
    chaveFalhou = true;
    console.warn("Chave do Google Maps não autorizada para este site – voltando para a base Esri.");
    ouvintesFalha.forEach((f) => f());
  };
  const pronta: Promise<void> = w.google?.maps?.Map
    ? Promise.resolve()
    : new Promise((ok, falha) => {
        const expira = setTimeout(() => falha(new Error("tempo esgotado ao carregar a Maps API")), 15_000);
        w.__lgGooglePronto = () => {
          clearTimeout(expira);
          ok();
        };
        const s = document.createElement("script");
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}&loading=async&callback=__lgGooglePronto`;
        s.async = true;
        s.onerror = () => {
          clearTimeout(expira);
          falha(new Error("falha ao carregar a Maps API"));
        };
        document.head.appendChild(s);
      });
  carregando = pronta.then(async () => {
    garantirLGlobal();
    const m = await import("leaflet.gridlayer.googlemutant/src/Leaflet.GoogleMutant.mjs");
    return m.default;
  });
  carregando.catch(() => {
    carregando = null;
  });
  return carregando;
}
