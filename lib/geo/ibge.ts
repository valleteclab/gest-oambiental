import "server-only";
import { codigoIbgeReal } from "@/lib/geo/uf";
import { CacheMemoria, buscarJson } from "@/lib/geo/http";

// Limite do município pela API de malhas do IBGE (v3), buscado no servidor e guardado em memória (24 h).
// Os códigos fictícios da demonstração (99…) não existem no IBGE → null.

const cache = new CacheMemoria<GeoJSON.FeatureCollection | null>(200, 24 * 60 * 60 * 1000);

export function urlMalhaMunicipio(codigo: string) {
  return `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${codigo}?formato=application/vnd.geo%2Bjson&qualidade=intermediaria`;
}

export async function limiteMunicipio(codigo: string): Promise<GeoJSON.FeatureCollection | null> {
  if (!codigoIbgeReal(codigo)) return null;
  const em = cache.obter(codigo);
  if (em !== undefined) return em;
  const fc = await buscarJson<GeoJSON.FeatureCollection>(urlMalhaMunicipio(codigo), 12_000);
  const ok = fc && fc.type === "FeatureCollection" && Array.isArray(fc.features) && fc.features.length > 0 ? fc : null;
  cache.definir(codigo, ok);
  return ok;
}
