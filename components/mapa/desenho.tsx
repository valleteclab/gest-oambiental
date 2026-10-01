"use client";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import { areaM2, extrairPoligono, type PoligonoGeo } from "@/lib/geo/validar";
import { garantirLGlobal } from "./config-cliente";

// Desenho/edição de UM polígono (ou multipolígono importado) com Leaflet-Geoman.
// O polígono controlado vem do pai (`poligono`); cada alteração chama onPoligono(geometria, áreaM²).

type MapaPm = L.Map & {
  pm: {
    addControls: (o: Record<string, unknown>) => void;
    removeControls: () => void;
    setLang: (l: string) => void;
    setGlobalOptions: (o: Record<string, unknown>) => void;
    disableDraw: () => void;
    disableGlobalEditMode: () => void;
    disableGlobalRemovalMode: () => void;
  };
};

const ESTILO = { color: "#facc15", weight: 3, fillColor: "#facc15", fillOpacity: 0.15 };

export function DesenhoPoligono({ poligono, onPoligono }: { poligono: GeoJSON.GeoJsonObject | null | undefined; onPoligono?: (g: PoligonoGeo | null, areaM2: number) => void }) {
  const map = useMap() as MapaPm;
  const grupoRef = useRef<L.FeatureGroup | null>(null);
  const ultimoRef = useRef<string>("");
  const registrarRef = useRef<(l: L.Layer) => void>(() => {});
  const cbRef = useRef(onPoligono);
  cbRef.current = onPoligono;
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;
    const grupo = L.featureGroup().addTo(map);
    grupoRef.current = grupo;
    const emitir = () => {
      const feicoes: GeoJSON.Feature[] = [];
      grupo.eachLayer((l) => {
        if (l instanceof L.Polygon) feicoes.push(l.toGeoJSON(7));
      });
      const g = extrairPoligono({ type: "FeatureCollection", features: feicoes });
      ultimoRef.current = g ? JSON.stringify(g) : "";
      cbRef.current?.(g, g ? areaM2(g) : 0);
    };
    const registrar = (l: L.Layer) => {
      l.on("pm:edit pm:dragend", emitir);
      if (l instanceof L.Path) l.setStyle(ESTILO);
    };
    const aoCriar = (e: { layer: L.Layer }) => {
      grupo.eachLayer((l) => map.removeLayer(l)); // um polígono por vez
      grupo.clearLayers();
      map.removeLayer(e.layer);
      grupo.addLayer(e.layer);
      registrar(e.layer);
      emitir();
    };
    const aoRemover = (e: { layer: L.Layer }) => {
      grupo.removeLayer(e.layer);
      emitir();
    };
    registrarRef.current = registrar;
    garantirLGlobal();
    import("@geoman-io/leaflet-geoman-free").then(() => {
      if (!vivo) return;
      // O Geoman instala `map.pm` por init hook; como é carregado depois do mapa criado, instala-se aqui.
      if (!map.pm) {
        const PM = (window as unknown as { L: { PM: { Map: new (m: L.Map) => MapaPm["pm"] } } }).L.PM;
        map.pm = new PM.Map(map);
        map.pm.setGlobalOptions({});
      }
      map.pm.setLang("pt_br");
      map.pm.setGlobalOptions({ allowSelfIntersection: false, snappable: true, templineStyle: { color: "#facc15" }, hintlineStyle: { color: "#facc15", dashArray: [5, 5] }, pathOptions: ESTILO });
      map.pm.addControls({
        position: "topleft", drawMarker: false, drawCircleMarker: false, drawPolyline: false, drawRectangle: true, drawPolygon: true, drawCircle: false, drawText: false,
        editMode: true, dragMode: false, cutPolygon: false, removalMode: true, rotateMode: false,
      });
      map.on("pm:create", aoCriar as L.LeafletEventHandlerFn);
      map.on("pm:remove", aoRemover as L.LeafletEventHandlerFn);
      setPronto(true);
    });
    return () => {
      vivo = false;
      map.off("pm:create", aoCriar as L.LeafletEventHandlerFn);
      map.off("pm:remove", aoRemover as L.LeafletEventHandlerFn);
      try {
        map.pm?.disableDraw();
        map.pm?.disableGlobalEditMode();
        map.pm?.disableGlobalRemovalMode();
        map.pm?.removeControls();
      } catch {
        /* mapa já destruído */
      }
      grupo.remove();
      grupoRef.current = null;
    };
  }, [map]);

  // Polígono vindo de fora (valor salvo, arquivo importado, imóvel do CAR, GeoJSON digitado)
  useEffect(() => {
    const grupo = grupoRef.current;
    if (!grupo || !pronto) return;
    const g = poligono ? extrairPoligono(poligono) : null;
    const s = g ? JSON.stringify(g) : "";
    if (s === ultimoRef.current) return;
    ultimoRef.current = s;
    grupo.eachLayer((l) => map.removeLayer(l));
    grupo.clearLayers();
    if (!g) return;
    L.geoJSON(g).eachLayer((l) => {
      grupo.addLayer(l);
      registrarRef.current(l);
    });
    const b = grupo.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [20, 20], maxZoom: 17 });
  }, [poligono, pronto, map]);

  return null;
}
