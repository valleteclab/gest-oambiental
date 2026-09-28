import "server-only";
import { buscarJson, ErroServicoExterno } from "../geo/http";
import { extrairPoligono, type PoligonoGeo } from "../geo/validar";
import { bboxDe, intersecta } from "./geo";
import {
  CONSULTA_MAPBIOMAS, MAPBIOMAS_GRAPHQL, converterDeter, converterMapbiomas, converterProdes, normalizarNome,
  urlDeterPorBbox, urlDeterPorMunicipio, urlProdesPorBbox, type AlertaNormalizado,
} from "./fontes";

// Busca dos alertas nas fontes externas (somente servidor). O fetch do Node precisa de NODE_USE_ENV_PROXY=1
// em ambientes com proxy de saída obrigatório (ver docs/mapas.md).

type FC = { features?: { id?: string | number; properties?: Record<string, unknown> | null; geometry?: unknown }[] };

const TEMPO_WFS = Number(process.env.MONITORAMENTO_TIMEOUT_MS ?? 120_000);

export type MunicipioMonitorado = { nome: string; uf: string; limite: PoligonoGeo | null };

const dentroDoLimite = (a: AlertaNormalizado, limite: PoligonoGeo | null) =>
  !limite || intersecta({ type: "Point", coordinates: [a.longitude, a.latitude] }, limite);

/** Converte o limite do IBGE (FeatureCollection) em Polygon/MultiPolygon. */
export function poligonoDoLimite(fc: GeoJSON.FeatureCollection | null): PoligonoGeo | null {
  return fc ? extrairPoligono(fc) : null;
}

/** Mesmo alerta pode vir duplicado (várias páginas/feições): fica o primeiro por id_externo. */
function unicos(xs: AlertaNormalizado[]): AlertaNormalizado[] {
  const m = new Map<string, AlertaNormalizado>();
  for (const x of xs) if (!m.has(x.id_externo)) m.set(x.id_externo, x);
  return [...m.values()];
}

/**
 * DETER Cerrado desde `desde` (AAAA-MM-DD). Filtro pelo município que o INPE atribuiu ao alerta (nome + UF);
 * se o nome não retornar nada e houver limite, busca pelo retângulo e mantém os alertas com centroide no município.
 */
export async function buscarDeter(m: MunicipioMonitorado, desde: string): Promise<{ alertas: AlertaNormalizado[]; metodo: "NOME" | "BBOX"; url: string }> {
  const url = urlDeterPorMunicipio(m.nome, m.uf, desde);
  const fc = await buscarJson<FC>(url, TEMPO_WFS);
  const porNome = (fc.features ?? []).map(converterDeter).filter((x): x is AlertaNormalizado => !!x);
  if (porNome.length || !m.limite) return { alertas: unicos(porNome), metodo: "NOME", url };
  const url2 = urlDeterPorBbox(bboxDe(m.limite), desde);
  const fc2 = await buscarJson<FC>(url2, TEMPO_WFS);
  const alvo = normalizarNome(m.nome);
  const todos = (fc2.features ?? []).map(converterDeter).filter((x): x is AlertaNormalizado => !!x);
  const r = todos.filter((a) => {
    const mun = typeof a.dados_fonte.municipality === "string" ? normalizarNome(a.dados_fonte.municipality) : null;
    return mun ? mun === alvo : dentroDoLimite(a, m.limite);
  });
  return { alertas: unicos(r.length ? r : todos.filter((a) => dentroDoLimite(a, m.limite))), metodo: "BBOX", url: url2 };
}

/** PRODES Cerrado (anos ≥ anoMinimo) – exige o limite do município (retângulo + centroide dentro do limite). */
export async function buscarProdes(m: MunicipioMonitorado, anoMinimo: number): Promise<{ alertas: AlertaNormalizado[]; url: string }> {
  if (!m.limite) throw new ErroServicoExterno("Limite do município (IBGE) indisponível – PRODES exige o polígono do município.");
  const url = urlProdesPorBbox(bboxDe(m.limite), anoMinimo);
  const fc = await buscarJson<FC>(url, TEMPO_WFS);
  const r = (fc.features ?? []).map(converterProdes).filter((x): x is AlertaNormalizado => !!x).filter((a) => dentroDoLimite(a, m.limite));
  return { alertas: unicos(r), url };
}

export const tokenMapbiomas = () => (process.env.MAPBIOMAS_ALERTA_TOKEN ?? "").trim() || null;

/**
 * MapBiomas Alerta (opcional, exige MAPBIOMAS_ALERTA_TOKEN – conta institucional em plataforma.alerta.mapbiomas.org).
 * Consulta GraphQL por bbox do município e período; mantém os alertas com centroide no município.
 */
export async function buscarMapbiomas(m: MunicipioMonitorado, desde: string, ate: string): Promise<{ alertas: AlertaNormalizado[] }> {
  const token = tokenMapbiomas();
  if (!token) return { alertas: [] };
  if (!m.limite) throw new ErroServicoExterno("Limite do município (IBGE) indisponível.");
  const bbox = bboxDe(m.limite);
  const alertas: AlertaNormalizado[] = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await fetch(MAPBIOMAS_GRAPHQL, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: CONSULTA_MAPBIOMAS, variables: { bbox, inicio: desde, fim: ate, pagina, limite: 100 } }),
      cache: "no-store",
    });
    if (!r.ok) throw new ErroServicoExterno(`MapBiomas HTTP ${r.status}`, r.status);
    const j = (await r.json()) as { data?: { alerts?: { collection?: unknown[] } }; errors?: { message?: string }[] };
    if (j.errors?.length) throw new ErroServicoExterno(`MapBiomas: ${j.errors[0]?.message ?? "erro"}`);
    const col = j.data?.alerts?.collection ?? [];
    alertas.push(...col.map((x) => converterMapbiomas(x as never)).filter((x): x is AlertaNormalizado => !!x).filter((a) => dentroDoLimite(a, m.limite)));
    if (col.length < 100) break;
  }
  return { alertas: unicos(alertas) };
}
