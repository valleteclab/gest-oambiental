import "server-only";
import { camada, resolverModelo } from "@/lib/geo/camadas";
import { extrairPoligono, TAMANHO_MAX_POLIGONO, type PoligonoGeo } from "@/lib/geo/validar";
import { CacheMemoria, buscarJson } from "@/lib/geo/http";

// Consulta ao GeoServer público do SICAR: imóvel rural (CAR) que contém um ponto.
// WFS 1.0.0 com CQL INTERSECTS(geo_area_imovel, POINT(lng lat)); se falhar, WMS GetFeatureInfo.
// O servidor do SICAR às vezes derruba a conexão (reset) – 1 nova tentativa antes do fallback.

export type ImovelCar = {
  cod_imovel: string;
  area_ha: number | null;
  situacao: string;
  condicao: string | null;
  tipo: string;
  municipio: string;
  uf: string;
  cod_municipio_ibge: number | null;
  modulos_fiscais: number | null;
  atualizado_em: string | null;
  /** Limite do imóvel (Polygon/MultiPolygon, ≤ 300 KB) – null se muito grande. */
  geometria: PoligonoGeo | null;
};

export const ROTULO_SITUACAO_CAR: Record<string, string> = { AT: "Ativo", PE: "Pendente", SU: "Suspenso", CA: "Cancelado" };
export const ROTULO_TIPO_CAR: Record<string, string> = { IRU: "Imóvel rural", AST: "Assentamento", PCT: "Povos e comunidades tradicionais" };

const cache = new CacheMemoria<ImovelCar[]>(500, 60 * 60 * 1000);
const WFS = "https://geoserver.car.gov.br/geoserver/sicar/ows";

type Feicao = { properties?: Record<string, unknown>; geometry?: unknown };

function paraImovel(f: Feicao, uf: string): ImovelCar | null {
  const p = f.properties ?? {};
  const cod = typeof p.cod_imovel === "string" ? p.cod_imovel : null;
  if (!cod) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  let geometria = f.geometry ? extrairPoligono(f.geometry) : null;
  if (geometria && JSON.stringify(geometria).length > TAMANHO_MAX_POLIGONO) geometria = null;
  const sit = String(p.status_imovel ?? "");
  return {
    cod_imovel: cod,
    area_ha: num(p.area),
    situacao: ROTULO_SITUACAO_CAR[sit] ?? sit,
    condicao: typeof p.condicao === "string" ? p.condicao : null,
    tipo: ROTULO_TIPO_CAR[String(p.tipo_imovel ?? "")] ?? String(p.tipo_imovel ?? ""),
    municipio: String(p.municipio ?? ""),
    uf: String(p.uf ?? uf.toUpperCase()),
    cod_municipio_ibge: num(p.cod_municipio_ibge),
    modulos_fiscais: num(p.m_fiscal),
    atualizado_em: typeof p.data_atualizacao === "string" ? p.data_atualizacao : typeof p.dat_criacao === "string" ? p.dat_criacao : null,
    geometria,
  };
}

function urlWfs(layer: string, lat: number, lng: number) {
  const q = new URLSearchParams({
    service: "WFS", version: "1.0.0", request: "GetFeature", typeName: layer, outputFormat: "application/json", maxFeatures: "5",
    CQL_FILTER: `INTERSECTS(geo_area_imovel,POINT(${lng} ${lat}))`,
  });
  return `${WFS}?${q}`;
}

function urlGetFeatureInfo(wms: string, layer: string, lat: number, lng: number) {
  const d = 0.0005;
  const q = new URLSearchParams({
    service: "WMS", version: "1.1.1", request: "GetFeatureInfo", layers: layer, query_layers: layer, styles: "", srs: "EPSG:4326",
    bbox: `${lng - d},${lat - d},${lng + d},${lat + d}`, width: "101", height: "101", x: "50", y: "50", info_format: "application/json", feature_count: "5",
  });
  return `${wms}?${q}`;
}

/** Imóveis do CAR que contêm o ponto (normalmente 0 ou 1; sobreposições são possíveis). */
export async function consultarCarNoPonto(lat: number, lng: number, uf: string): Promise<ImovelCar[]> {
  const c = camada("car")!;
  const layer = resolverModelo(c.layers!, { uf });
  const chave = `${layer}:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const em = cache.obter(chave);
  if (em) return em;
  let json: { features?: Feicao[] } | null = null;
  let ultimoErro: unknown = null;
  for (const url of [urlWfs(layer, lat, lng), urlWfs(layer, lat, lng), urlGetFeatureInfo(c.url, layer, lat, lng)]) {
    try {
      json = await buscarJson<{ features?: Feicao[] }>(url, 12_000);
      break;
    } catch (e) {
      ultimoErro = e;
    }
  }
  if (!json) throw ultimoErro ?? new Error("SICAR indisponível");
  const r = (json.features ?? []).map((f) => paraImovel(f, uf)).filter((x): x is ImovelCar => !!x);
  cache.definir(chave, r);
  return r;
}
