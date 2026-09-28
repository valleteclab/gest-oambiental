"use client";
import { validarPoligono, type ResultadoValidacao } from "@/lib/geo/validar";

// Importação de polígono no navegador: KML, KMZ, GeoJSON e Shapefile (.zip com .shp/.dbf/.prj).
// As bibliotecas são carregadas só quando o usuário escolhe um arquivo.

export const ACEITA_IMPORTACAO = ".kml,.kmz,.geojson,.json,.zip,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/geo+json,application/json,application/zip";
const MAX_ARQUIVO = 10 * 1024 * 1024;

async function kmlParaGeoJson(texto: string): Promise<GeoJSON.FeatureCollection> {
  const { kml } = await import("@tmcw/togeojson");
  const doc = new DOMParser().parseFromString(texto, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("KML inválido.");
  return kml(doc) as GeoJSON.FeatureCollection;
}

export async function lerArquivoGeo(arquivo: File): Promise<unknown> {
  if (arquivo.size > MAX_ARQUIVO) throw new Error("Arquivo muito grande (máx. 10 MB).");
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith(".kml")) return kmlParaGeoJson(await arquivo.text());
  if (nome.endsWith(".kmz")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await arquivo.arrayBuffer());
    const kmlArq = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith(".kml"));
    if (!kmlArq) throw new Error("O KMZ não contém um arquivo .kml.");
    return kmlParaGeoJson(await kmlArq.async("text"));
  }
  if (nome.endsWith(".zip")) {
    const shp = (await import("shpjs")).default;
    try {
      const r = await shp(await arquivo.arrayBuffer());
      const lista = Array.isArray(r) ? r : [r];
      return { type: "FeatureCollection", features: lista.flatMap((fc) => fc.features ?? []) } satisfies GeoJSON.FeatureCollection;
    } catch {
      throw new Error("Não foi possível ler o shapefile. Envie um .zip com .shp, .shx, .dbf e .prj.");
    }
  }
  if (nome.endsWith(".geojson") || nome.endsWith(".json")) {
    try {
      return JSON.parse(await arquivo.text());
    } catch {
      throw new Error("GeoJSON inválido.");
    }
  }
  throw new Error("Formato não suportado. Use KML, KMZ, GeoJSON ou Shapefile (.zip).");
}

/** Lê o arquivo e devolve o polígono validado (Polygon/MultiPolygon, ≤ 300 KB) com a área. */
export async function importarPoligono(arquivo: File): Promise<ResultadoValidacao> {
  try {
    return validarPoligono(await lerArquivoGeo(arquivo));
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao ler o arquivo." };
  }
}
