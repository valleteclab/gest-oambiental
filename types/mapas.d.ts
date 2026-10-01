// Declarações mínimas de pacotes de mapa sem tipos próprios.
declare module "shpjs" {
  type Resultado = GeoJSON.FeatureCollection & { fileName?: string };
  const shp: (entrada: ArrayBuffer | Uint8Array | string) => Promise<Resultado | Resultado[]>;
  export default shp;
}

declare module "leaflet.gridlayer.googlemutant/src/Leaflet.GoogleMutant.mjs" {
  import type { GridLayer, GridLayerOptions } from "leaflet";
  export type OpcoesGoogleMutant = GridLayerOptions & { type?: "roadmap" | "satellite" | "terrain" | "hybrid"; styles?: unknown[]; maxZoom?: number };
  export default class GoogleMutant extends GridLayer {
    constructor(opcoes?: OpcoesGoogleMutant);
  }
}
