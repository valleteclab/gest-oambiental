// Geometria do monitoramento (pura – turf): simplificação ≤ 300 KB, centroide, bbox, sobreposição em hectares.
import turfArea from "@turf/area";
import turfBbox from "@turf/bbox";
import turfCentroid from "@turf/centroid";
import turfIntersect from "@turf/intersect";
import turfSimplify from "@turf/simplify";
import booleanIntersects from "@turf/boolean-intersects";
import { feature, featureCollection } from "@turf/helpers";
import { extrairPoligono, TAMANHO_MAX_POLIGONO, type PoligonoGeo } from "../geo/validar";

export type Bbox = [number, number, number, number]; // [oeste, sul, leste, norte]

const tamanho = (g: unknown) => JSON.stringify(g).length;

/** Normaliza (Polygon/MultiPolygon 2D, 7 casas) e simplifica progressivamente até caber em `maxBytes`. Null se não couber. */
export function simplificarGeometria(entrada: unknown, maxBytes = TAMANHO_MAX_POLIGONO): PoligonoGeo | null {
  let g = extrairPoligono(entrada);
  if (!g) return null;
  // 5 casas decimais ≈ 1 m: suficiente para alertas de satélite (pixel ≥ 10 m) e reduz o JSON.
  const arred = (n: number) => Math.round(n * 1e5) / 1e5;
  const reduzir = (x: PoligonoGeo): PoligonoGeo =>
    x.type === "Polygon"
      ? { type: "Polygon", coordinates: x.coordinates.map((a) => a.map(([lng, lat]) => [arred(lng), arred(lat)])) }
      : { type: "MultiPolygon", coordinates: x.coordinates.map((p) => p.map((a) => a.map(([lng, lat]) => [arred(lng), arred(lat)]))) };
  g = reduzir(g);
  const original = g;
  for (const tol of [0.00002, 0.00005, 0.0001, 0.0002, 0.0005, 0.001, 0.002]) {
    if (tamanho(g) <= maxBytes) return g;
    const r = simplificarPartes(original, tol);
    if (r) g = r;
  }
  return tamanho(g) <= maxBytes ? g : null;
}

/**
 * Simplifica cada parte (polígono) separadamente; partes/buracos que colapsam (< 4 posições) são descartados
 * – o turf lança "invalid polygon" nesses casos. Null se nada sobrar.
 */
function simplificarPartes(g: PoligonoGeo, tolerancia: number): PoligonoGeo | null {
  const partes = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const saida: PoligonoGeo["coordinates"][] = [];
  for (const p of partes) {
    try {
      const s = turfSimplify(feature({ type: "Polygon", coordinates: p }), { tolerance: tolerancia, highQuality: false, mutate: false });
      const aneis = (s.geometry.coordinates as [number, number][][]).filter((a) => a.length >= 4);
      if (aneis.length && aneis[0] === s.geometry.coordinates[0]) saida.push(aneis as never);
    } catch {
      /* parte degenerada nesta tolerância: descartada */
    }
  }
  if (!saida.length) return null;
  return saida.length === 1 ? { type: "Polygon", coordinates: saida[0] as never } : { type: "MultiPolygon", coordinates: saida as never };
}

/** Área geodésica em hectares. */
export function areaHa(g: PoligonoGeo): number {
  return turfArea(feature(g)) / 10_000;
}

/** Centroide {lat, lng} (6 casas). */
export function centroide(g: PoligonoGeo): { lat: number; lng: number } {
  const [lng, lat] = turfCentroid(feature(g)).geometry.coordinates;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export function bboxDe(g: PoligonoGeo | GeoJSON.GeoJSON): Bbox {
  const b = turfBbox(g as GeoJSON.GeoJSON);
  return [b[0], b[1], b[2], b[3]];
}

/** Retângulo do bbox em WKT (lon lat) – filtro CQL curto para o WFS do SICAR. */
export function wktBbox([o, s, l, n]: Bbox): string {
  return `POLYGON((${o} ${s},${l} ${s},${l} ${n},${o} ${n},${o} ${s}))`;
}

/** Área (ha) da interseção entre o alerta e outra geometria (imóvel do CAR, empreendimento). 0 se não se tocam. */
export function sobreposicaoHa(a: PoligonoGeo, b: PoligonoGeo): number {
  try {
    const fa = feature(a);
    const fb = feature(b);
    if (!booleanIntersects(fa, fb)) return 0;
    const i = turfIntersect(featureCollection([fa, fb]));
    return i ? turfArea(i) / 10_000 : 0;
  } catch {
    // Geometria inválida (autointerseção) no dado de origem: estima pelo bbox não é seguro – considera 0.
    return 0;
  }
}

/** A geometria (ou ponto) toca o polígono do município? Usado para descartar feições do bbox fora do limite. */
export function intersecta(a: PoligonoGeo | GeoJSON.Geometry, b: PoligonoGeo | GeoJSON.Geometry): boolean {
  try {
    return booleanIntersects(a as GeoJSON.Geometry, b as GeoJSON.Geometry);
  } catch {
    return false;
  }
}

/** Arredonda hectares para exibição/armazenamento (4 casas). */
export const arredHa = (n: number) => Math.round(n * 10_000) / 10_000;
