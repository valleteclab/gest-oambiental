"use client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { camada } from "@/lib/geo/camadas";

// Legenda das sobreposições ligadas (canto inferior esquerdo), com aviso de zoom mínimo e de serviço indisponível.

export function LegendaMapa({ ativas, erros }: { ativas: string[]; erros: Record<string, true> }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
  });
  const itens = ativas.map((id) => camada(id)).filter((c) => c && c.legenda);
  if (!itens.length) return null;
  return (
    <div ref={ref} className="absolute bottom-6 left-2 z-[1000] max-w-[calc(100%-1rem)] rounded-md bg-white/95 px-2.5 py-2 text-[11px] leading-tight text-slate-800 shadow-md sm:max-w-xs" data-testid="mapa-legenda" aria-label="Legenda do mapa">
      <ul className="space-y-1.5">
        {itens.map((c) => (
          <li key={c!.id} className="flex items-start gap-2">
            <Simbolo cor={c!.legenda!.cor} forma={c!.legenda!.forma} />
            <span>
              <span className="font-medium">{c!.nome}</span>
              <span className="block text-slate-500">{c!.fonte}</span>
              {c!.minZoom != null && zoom < c!.minZoom && <span className="block text-amber-700">Aproxime o mapa para ver (zoom ≥ {c!.minZoom}).</span>}
              {erros[c!.id] && <span className="block text-red-700" role="status">{c!.mensagemErro ?? "Serviço indisponível no momento."}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Simbolo({ cor, forma }: { cor: string; forma: "linha" | "area" | "tracejado" }) {
  if (forma === "area") return <span aria-hidden className="mt-0.5 inline-block h-3 w-4 shrink-0 rounded-sm border" style={{ background: `${cor}99`, borderColor: cor }} />;
  return <span aria-hidden className="mt-1.5 inline-block w-4 shrink-0 border-t-[3px]" style={{ borderColor: cor, borderTopStyle: forma === "tracejado" ? "dashed" : "solid" }} />;
}
