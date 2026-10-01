// Validação de polígonos GeoJSON (empreendimentos, áreas desenhadas/importadas no mapa).
// Pura (sem dependências de servidor): usada no servidor (zod em lib/cadastros/validacao.ts) e no cliente (importação).
import { z } from "zod";
import turfArea from "@turf/area";

export const TAMANHO_MAX_POLIGONO = 300 * 1024; // 300 KB de JSON

export type Posicao = [number, number];
export type PoligonoGeo = { type: "Polygon"; coordinates: Posicao[][] } | { type: "MultiPolygon"; coordinates: Posicao[][][] };

const Coord = z
  .array(z.number().finite(), { error: "Coordenada inválida." })
  .min(2, "Coordenada inválida.")
  .max(4, "Coordenada inválida.")
  .refine((c) => c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90, "Coordenada fora do intervalo (longitude −180..180, latitude −90..90).");

const Anel = z
  .array(Coord)
  .min(4, "Cada anel do polígono precisa de ao menos 4 posições (3 vértices + fechamento).")
  .refine((a) => a.length < 4 || (a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1]), "Anel do polígono não está fechado (primeira posição ≠ última).");

const Polygon = z.object({ type: z.literal("Polygon"), coordinates: z.array(Anel).min(1, "Polígono sem coordenadas.") });
const MultiPolygon = z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(Anel).min(1)).min(1, "Multipolígono sem coordenadas.") });

/** Geometria Polygon/MultiPolygon válida (anéis fechados, coordenadas no intervalo). */
export const GeometriaPoligonoSchema = z.discriminatedUnion("type", [Polygon, MultiPolygon], {
  error: "GeoJSON deve ser Polygon ou MultiPolygon.",
});

/**
 * Extrai uma geometria Polygon/MultiPolygon de Geometry, Feature ou FeatureCollection
 * (várias áreas → MultiPolygon). Descarta altitude (KML traz x,y,z). Retorna null se não houver polígono.
 */
export function extrairPoligono(obj: unknown): PoligonoGeo | null {
  const polis: Posicao[][][] = [];
  const visitar = (g: unknown, prof = 0) => {
    if (!g || typeof g !== "object" || prof > 5) return;
    const o = g as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[]; geometries?: unknown[] };
    if (o.type === "Feature") return visitar(o.geometry, prof + 1);
    if (o.type === "FeatureCollection" && Array.isArray(o.features)) return o.features.forEach((f) => visitar(f, prof + 1));
    if (o.type === "GeometryCollection" && Array.isArray(o.geometries)) return o.geometries.forEach((f) => visitar(f, prof + 1));
    if (o.type === "Polygon" && Array.isArray(o.coordinates)) polis.push(o.coordinates as Posicao[][]);
    if (o.type === "MultiPolygon" && Array.isArray(o.coordinates)) polis.push(...(o.coordinates as Posicao[][][]));
  };
  visitar(obj);
  if (!polis.length) return null;
  const limpar = (p: Posicao[][]) => p.map((anel) => anel.map((c) => [arred(Number(c[0])), arred(Number(c[1]))] as Posicao));
  return polis.length === 1 ? { type: "Polygon", coordinates: limpar(polis[0]) } : { type: "MultiPolygon", coordinates: polis.map(limpar) };
}

/** 7 casas decimais ≈ 1 cm – reduz o tamanho do JSON sem perda prática. */
function arred(n: number) {
  return Math.round(n * 1e7) / 1e7;
}

export type ResultadoValidacao = { ok: true; geometria: PoligonoGeo; areaM2: number } | { ok: false; erro: string };

/** Valida (e normaliza) um polígono vindo de formulário/API/arquivo: string JSON ou objeto. */
export function validarPoligono(entrada: unknown): ResultadoValidacao {
  let obj = entrada;
  if (typeof entrada === "string") {
    if (new TextEncoder().encode(entrada).length > TAMANHO_MAX_POLIGONO * 4) return { ok: false, erro: "Polígono muito grande." };
    try {
      obj = JSON.parse(entrada);
    } catch {
      return { ok: false, erro: "JSON inválido." };
    }
  }
  if (!obj || typeof obj !== "object") return { ok: false, erro: "GeoJSON inválido." };
  const tipo = (obj as { type?: unknown }).type;
  const geo = tipo === "Polygon" || tipo === "MultiPolygon" ? obj : extrairPoligono(obj);
  if (!geo) return { ok: false, erro: "GeoJSON deve conter um Polygon ou MultiPolygon." };
  const r = GeometriaPoligonoSchema.safeParse(geo);
  if (!r.success) return { ok: false, erro: r.error.issues[0]?.message ?? "Polígono inválido." };
  const geometria = extrairPoligono(r.data)!; // normaliza (2D, 7 casas)
  const tamanho = new TextEncoder().encode(JSON.stringify(geometria)).length;
  if (tamanho > TAMANHO_MAX_POLIGONO) return { ok: false, erro: `Polígono muito detalhado (${Math.round(tamanho / 1024)} KB; máximo ${TAMANHO_MAX_POLIGONO / 1024} KB). Simplifique a geometria.` };
  return { ok: true, geometria, areaM2: areaM2(geometria) };
}

/** Área geodésica em m² (turf). */
export function areaM2(g: PoligonoGeo | GeoJSON.Geometry | GeoJSON.Feature | GeoJSON.FeatureCollection): number {
  return turfArea(g as GeoJSON.Geometry);
}

export const m2ParaHa = (m2: number) => m2 / 10_000;

/** Zod: aceita string/objeto vazio (→ null) ou polígono válido (→ geometria normalizada). */
export const PoligonoGeoJsonSchema = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const r = validarPoligono(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: `Polígono: ${r.erro}` });
      return z.NEVER;
    }
    return r.geometria;
  });
