// Fontes de alertas de desmatamento (puro: URLs e conversão das feições; a rede fica em provedores.ts).
//   DETER Cerrado – INPE TerraBrasilis WFS `deter-cerrado-nb:deter_cerrado` (gid, classname, view_date, areamunkm, municipality, uf)
//   PRODES Cerrado – INPE TerraBrasilis WFS `prodes-cerrado-nb:yearly_deforestation` (uuid, main_class, class_name, year, image_date, area_km)
//   MapBiomas Alerta – API GraphQL (exige conta/token: MAPBIOMAS_ALERTA_TOKEN) – opcional
// Ver docs/monitoramento.md (endereços testados, atributos, limites).
import type { FonteAlertaDesmatamento } from "@prisma/client";
import { areaHa, arredHa, centroide, simplificarGeometria, type Bbox } from "./geo";
import type { PoligonoGeo } from "../geo/validar";

export const TERRABRASILIS_OWS = "https://terrabrasilis.dpi.inpe.br/geoserver/ows";
export const CAMADA_DETER = "deter-cerrado-nb:deter_cerrado";
export const CAMADA_PRODES = "prodes-cerrado-nb:yearly_deforestation";
export const MAPBIOMAS_GRAPHQL = "https://plataforma.alerta.mapbiomas.org/api/v2/graphql";

export type AlertaNormalizado = {
  fonte: FonteAlertaDesmatamento;
  id_externo: string;
  classe: string;
  /** AAAA-MM-DD */
  data_deteccao: string;
  area_ha: number;
  geometria: PoligonoGeo | null;
  latitude: number;
  longitude: number;
  dados_fonte: Record<string, unknown>;
};

type Feicao = { id?: string | number; properties?: Record<string, unknown> | null; geometry?: unknown };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const dataIso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Nome do município como o INPE grava no DETER: maiúsculas, com acentos ("RIACHÃO DAS NEVES"). */
export const nomeMunicipioInpe = (nome: string) => nome.trim().toLocaleUpperCase("pt-BR");
/** Comparação tolerante (sem acentos/pontuação). */
export const normalizarNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().toUpperCase();

const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;

function urlWfs(typeName: string, cql: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ service: "WFS", version: "1.0.0", request: "GetFeature", typeName, outputFormat: "application/json", srsName: "EPSG:4326", CQL_FILTER: cql, ...extra });
  return `${TERRABRASILIS_OWS}?${q}`;
}

/** DETER Cerrado do município (pelo nome + UF gravados pelo INPE) desde `desde` (AAAA-MM-DD). */
export function urlDeterPorMunicipio(nomeMunicipio: string, uf: string, desde: string): string {
  return urlWfs(CAMADA_DETER, `municipality=${aspas(nomeMunicipioInpe(nomeMunicipio))} AND uf=${aspas(uf.toUpperCase())} AND view_date>=${aspas(desde)}`);
}

/** DETER Cerrado no retângulo do município (alternativa quando o nome não bate) – filtrar depois pelo limite. */
export function urlDeterPorBbox([o, s, l, n]: Bbox, desde: string): string {
  return urlWfs(CAMADA_DETER, `BBOX(st_multi,${o},${s},${l},${n}) AND view_date>=${aspas(desde)}`);
}

/** PRODES Cerrado (desmatamento anual) no retângulo do município, anos ≥ `anoMinimo` – filtrar depois pelo limite. */
export function urlProdesPorBbox([o, s, l, n]: Bbox, anoMinimo: number): string {
  return urlWfs(CAMADA_PRODES, `BBOX(geom,${o},${s},${l},${n}) AND year>=${Math.trunc(anoMinimo)} AND main_class='DESMATAMENTO'`);
}

function comGeometria(f: Feicao): { geometria: PoligonoGeo | null; lat: number; lng: number; areaCalc: number } | null {
  const g = simplificarGeometria(f.geometry);
  if (!g) return null;
  const c = centroide(g);
  return { geometria: g, lat: c.lat, lng: c.lng, areaCalc: areaHa(g) };
}

/** Feição do DETER → alerta normalizado (null se faltar id/data/geometria). Área: areamunkm (parte no município) × 100. */
export function converterDeter(f: Feicao): AlertaNormalizado | null {
  const p = f.properties ?? {};
  const id = str(p.gid) ?? (f.id != null ? String(f.id).replace(/^deter_cerrado\./, "") : null);
  const data = dataIso(p.view_date);
  if (!id || !data) return null;
  const g = comGeometria(f);
  if (!g) return null;
  const km2 = num(p.areamunkm) ?? num(p.areatotalkm);
  return {
    fonte: "DETER",
    id_externo: id,
    classe: str(p.classname) ?? "DESMATAMENTO",
    data_deteccao: data,
    area_ha: arredHa(km2 != null ? km2 * 100 : g.areaCalc),
    geometria: g.geometria,
    latitude: g.lat,
    longitude: g.lng,
    dados_fonte: {
      classname: p.classname ?? null, view_date: p.view_date ?? null, created_date: p.created_date ?? null, publish_month: p.publish_month ?? null,
      areatotalkm: num(p.areatotalkm), areamunkm: num(p.areamunkm), municipality: p.municipality ?? null, uf: p.uf ?? null,
      satellite: p.satellite ?? null, sensor: p.sensor ?? null, path_row: p.path_row ?? null, uc: p.uc ?? null,
    },
  };
}

/** Feição do PRODES → alerta normalizado. Data: image_date (ou 01/08 do ano PRODES). */
export function converterProdes(f: Feicao): AlertaNormalizado | null {
  const p = f.properties ?? {};
  const id = str(p.uuid) ?? (f.id != null ? String(f.id).replace(/^yearly_deforestation\./, "") : null);
  const ano = num(p.year);
  const data = dataIso(p.image_date) ?? (ano ? `${ano}-08-01` : null);
  if (!id || !data) return null;
  const g = comGeometria(f);
  if (!g) return null;
  const km2 = num(p.area_km);
  return {
    fonte: "PRODES",
    id_externo: id,
    classe: str(p.class_name) ?? str(p.main_class) ?? "DESMATAMENTO",
    data_deteccao: data,
    area_ha: arredHa(km2 != null ? km2 * 100 : g.areaCalc),
    geometria: g.geometria,
    latitude: g.lat,
    longitude: g.lng,
    dados_fonte: {
      main_class: p.main_class ?? null, class_name: p.class_name ?? null, year: ano, image_date: p.image_date ?? null, area_km: km2,
      state: p.state ?? null, satellite: p.satellite ?? null, sensor: p.sensor ?? null, path_row: p.path_row ?? null, pub_date: p.pub_date ?? null,
    },
  };
}

// ───────────────────────── MapBiomas Alerta (opcional) ─────────────────────────

export const CONSULTA_MAPBIOMAS = `query Alertas($bbox: [Float!], $inicio: BaseDate, $fim: BaseDate, $pagina: Int, $limite: Int) {
  alerts(boundingBox: $bbox, startDate: $inicio, endDate: $fim, page: $pagina, limit: $limite) {
    collection { alertCode areaHa detectedAt publishedAt coordinates { latitude longitude } boundingBox }
  }
}`;

type AlertaMapbiomas = { alertCode?: string | number | null; areaHa?: number | null; detectedAt?: string | null; publishedAt?: string | null; coordinates?: { latitude?: number; longitude?: number } | null; boundingBox?: number[] | null };

/**
 * Alerta do MapBiomas → normalizado. A API pública não entrega o polígono no tipo Alert (só bbox e coordenadas):
 * a geometria é o retângulo do bbox (marcada `geometria_aproximada`). Formato do bbox: [oeste, sul, leste, norte].
 */
export function converterMapbiomas(a: AlertaMapbiomas): AlertaNormalizado | null {
  const id = str(a.alertCode);
  const data = dataIso(a.detectedAt);
  if (!id || !data) return null;
  const b = Array.isArray(a.boundingBox) && a.boundingBox.length === 4 && a.boundingBox.every((x) => Number.isFinite(x)) ? a.boundingBox : null;
  const geometria: PoligonoGeo | null = b ? { type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } : null;
  const lat = num(a.coordinates?.latitude) ?? (b ? (b[1] + b[3]) / 2 : null);
  const lng = num(a.coordinates?.longitude) ?? (b ? (b[0] + b[2]) / 2 : null);
  if (lat == null || lng == null) return null;
  return {
    fonte: "MAPBIOMAS", id_externo: id, classe: "DESMATAMENTO", data_deteccao: data,
    area_ha: arredHa(num(a.areaHa) ?? (geometria ? areaHa(geometria) : 0)),
    geometria, latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6,
    dados_fonte: { alertCode: id, detectedAt: a.detectedAt ?? null, publishedAt: a.publishedAt ?? null, geometria_aproximada: true },
  };
}
