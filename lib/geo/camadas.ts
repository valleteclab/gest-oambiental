// Catálogo ÚNICO das camadas de mapa do LicenciaGov (bases e sobreposições).
// Usado pelo componente <Mapa> (cliente) e pelas rotas /api/v1/mapas/* (servidor) – não importar nada de servidor aqui.
//
// Cada serviço governamental foi testado a partir do container de desenvolvimento em 28/09/2026
// (GetCapabilities + GetMap na região oeste da Bahia, lat -11,75 lng -44,91). Ver docs/mapas.md.
//
// Placeholders: {uf} = sigla minúscula da UF do município (ba), {UF} = maiúscula (BA).

export type TipoCamada = "xyz" | "wms" | "geojson" | "google";
export type GrupoCamada = "base" | "sobreposicao";

export type Camada = {
  id: string;
  nome: string;
  grupo: GrupoCamada;
  tipo: TipoCamada;
  /** URL do serviço (xyz: template {z}/{x}/{y}; wms: endpoint; geojson: rota interna). */
  url: string;
  /** WMS: nome(s) da(s) camada(s), separados por vírgula. */
  layers?: string;
  /** WMS: estilo publicado no servidor ("" = padrão). */
  styles?: string;
  /** Google Maps (GoogleMutant): tipo do mapa. */
  googleTipo?: "satellite" | "hybrid" | "roadmap";
  attribution: string;
  /** Órgão/fonte do dado (exibido na legenda). */
  fonte: string;
  licenca: string;
  /** Abaixo deste zoom a camada não é requisitada (serviços pesados). */
  minZoom?: number;
  /** Zoom máximo com imagem nativa; acima disso os tiles são ampliados. */
  maxNativeZoom?: number;
  opacidade?: number;
  /** Cor da legenda e forma do símbolo. */
  legenda?: { cor: string; forma: "linha" | "area" | "tracejado" };
  /** Depende da UF do município ({uf} na url/layers). */
  porUf?: boolean;
  /** Serviço sabidamente instável/inacessível – exibe aviso amigável quando os tiles falham. */
  instavel?: boolean;
  /** Mensagem mostrada quando os tiles falham. */
  mensagemErro?: string;
  /** Pode aparecer em mapas públicos (portal de denúncias). */
  publico?: boolean;
  /** Resultado do teste de acesso a partir do servidor (ver docs/mapas.md). */
  teste: { data: string; ok: boolean; obs?: string };
};

export const ZOOM_MAXIMO = 20;

const ATTR_ESRI = 'Imagens &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics e comunidade GIS';
const TESTE_OK = { data: "2026-09-28", ok: true } as const;

export const CAMADAS: readonly Camada[] = [
  // ── Bases ────────────────────────────────────────────────────────────────
  {
    id: "esri-satelite", nome: "Satélite (Esri)", grupo: "base", tipo: "xyz",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    // Na zona rural do oeste baiano o zoom 18+ devolve "Map data not yet available": ampliar a partir do 17.
    maxNativeZoom: 17, attribution: ATTR_ESRI, fonte: "Esri World Imagery", licenca: "Termos Esri (uso com atribuição; uso comercial exige conta ArcGIS)",
    publico: true, teste: TESTE_OK,
  },
  {
    id: "osm", nome: "Mapa (OpenStreetMap)", grupo: "base", tipo: "xyz",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores do OpenStreetMap</a>',
    fonte: "OpenStreetMap", licenca: "ODbL (política de uso de tiles da OSMF)", publico: true, teste: TESTE_OK,
  },
  // Google: só aparecem quando GOOGLE_MAPS_KEY está configurada (Maps JavaScript API via GoogleMutant).
  { id: "google-satelite", nome: "Satélite (Google)", grupo: "base", tipo: "google", googleTipo: "satellite", url: "", maxNativeZoom: 21, attribution: "Imagens &copy; Google", fonte: "Google Maps Platform", licenca: "Termos do Google Maps Platform (faturamento por carga de mapa)", teste: { data: "2026-09-28", ok: true, obs: "exige chave" } },
  { id: "google-hibrido", nome: "Híbrido (Google)", grupo: "base", tipo: "google", googleTipo: "hybrid", url: "", maxNativeZoom: 21, attribution: "Imagens &copy; Google", fonte: "Google Maps Platform", licenca: "Termos do Google Maps Platform (faturamento por carga de mapa)", teste: { data: "2026-09-28", ok: true, obs: "exige chave" } },
  { id: "google-ruas", nome: "Ruas (Google)", grupo: "base", tipo: "google", googleTipo: "roadmap", url: "", maxNativeZoom: 21, attribution: "&copy; Google", fonte: "Google Maps Platform", licenca: "Termos do Google Maps Platform (faturamento por carga de mapa)", teste: { data: "2026-09-28", ok: true, obs: "exige chave" } },

  // ── Sobreposições ────────────────────────────────────────────────────────
  {
    id: "esri-rotulos", nome: "Rótulos (Esri)", grupo: "sobreposicao", tipo: "xyz",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 17, attribution: "Rótulos &copy; Esri", fonte: "Esri", licenca: "Termos Esri", publico: true, teste: TESTE_OK,
  },
  {
    id: "car", nome: "CAR – imóveis rurais (SICAR)", grupo: "sobreposicao", tipo: "wms",
    url: "https://geoserver.car.gov.br/geoserver/sicar/wms", layers: "sicar:sicar_imoveis_{uf}",
    // Estilo "line": só contornos (o padrão "polygon" preenche de cinza e esconde a imagem de satélite).
    styles: "line", minZoom: 11, opacidade: 0.9, porUf: true, legenda: { cor: "#2563eb", forma: "linha" },
    attribution: 'CAR &copy; <a href="https://www.car.gov.br/" target="_blank" rel="noopener">SICAR/SFB</a>',
    fonte: "SICAR – Serviço Florestal Brasileiro", licenca: "Dado público (Lei 12.651/2012, art. 29; LAI)",
    mensagemErro: "O serviço do CAR (SICAR) não respondeu. Tente novamente em instantes.", teste: TESTE_OK,
  },
  {
    id: "sigef", nome: "SIGEF – parcelas certificadas (INCRA)", grupo: "sobreposicao", tipo: "wms",
    url: "https://acervofundiario.incra.gov.br/i3geo/ogc.php?tema=certificada_sigef_particular_{uf}", layers: "certificada_sigef_particular_{uf}",
    styles: "", minZoom: 12, opacidade: 0.8, porUf: true, instavel: true, legenda: { cor: "#dc2626", forma: "linha" },
    attribution: 'SIGEF &copy; <a href="https://acervofundiario.incra.gov.br/" target="_blank" rel="noopener">INCRA</a>',
    fonte: "INCRA – Acervo Fundiário (i3Geo/OGC)", licenca: "Dado público (INCRA)",
    mensagemErro: "Serviço do INCRA indisponível no momento (Acervo Fundiário). A camada SIGEF será exibida quando o serviço voltar.",
    teste: { data: "2026-09-28", ok: false, obs: "conexão recusada (reset) a partir do servidor em 2 tentativas" },
  },
  {
    id: "limite-municipio", nome: "Limite do município (IBGE)", grupo: "sobreposicao", tipo: "geojson",
    url: "/api/v1/mapas/limite/{codigo_ibge}", legenda: { cor: "#f59e0b", forma: "tracejado" },
    attribution: 'Malha municipal &copy; <a href="https://servicodados.ibge.gov.br/api/docs/malhas" target="_blank" rel="noopener">IBGE</a>',
    fonte: "IBGE – API de malhas v3", licenca: "Dado público (IBGE)", teste: TESTE_OK,
  },
  {
    id: "ibge-municipios", nome: "Divisas municipais (IBGE BC250)", grupo: "sobreposicao", tipo: "wms",
    url: "https://geoservicos.ibge.gov.br/geoserver/ows", layers: "CCAR:BC250_2025_lml_municipio_a", styles: "",
    minZoom: 7, opacidade: 0.9, legenda: { cor: "#111827", forma: "linha" },
    attribution: 'Base cartográfica BC250 &copy; <a href="https://www.ibge.gov.br/" target="_blank" rel="noopener">IBGE</a>',
    fonte: "IBGE – Base Cartográfica Contínua 1:250.000 (2025)", licenca: "Dado público (IBGE)", teste: TESTE_OK,
  },
  {
    id: "ibge-hidrografia", nome: "Hidrografia (IBGE BC250)", grupo: "sobreposicao", tipo: "wms",
    url: "https://geoservicos.ibge.gov.br/geoserver/ows", layers: "CCAR:BC250_2025_hid_massa_dagua_a,CCAR:BC250_2025_hid_trecho_drenagem_l", styles: "",
    minZoom: 9, opacidade: 0.9, legenda: { cor: "#0ea5e9", forma: "linha" },
    attribution: 'Hidrografia BC250 &copy; <a href="https://www.ibge.gov.br/" target="_blank" rel="noopener">IBGE</a>',
    fonte: "IBGE – BC250 (trechos de drenagem e massas d'água)", licenca: "Dado público (IBGE)", teste: TESTE_OK,
  },
  {
    id: "prodes-cerrado", nome: "Desmatamento PRODES Cerrado (INPE)", grupo: "sobreposicao", tipo: "wms",
    url: "https://terrabrasilis.dpi.inpe.br/geoserver/ows", layers: "prodes-cerrado-nb:yearly_deforestation", styles: "",
    minZoom: 8, opacidade: 0.5, legenda: { cor: "#f59e0b", forma: "area" },
    attribution: 'PRODES &copy; <a href="https://terrabrasilis.dpi.inpe.br/" target="_blank" rel="noopener">INPE/TerraBrasilis</a>',
    fonte: "INPE – PRODES Cerrado (desmatamento anual)", licenca: "Dado público (CC BY-SA 4.0, INPE)", teste: TESTE_OK,
  },
  {
    id: "deter-cerrado", nome: "Alertas DETER Cerrado (INPE)", grupo: "sobreposicao", tipo: "wms",
    url: "https://terrabrasilis.dpi.inpe.br/geoserver/ows", layers: "deter-cerrado-nb:deter_cerrado", styles: "",
    minZoom: 8, opacidade: 0.8, legenda: { cor: "#e11d48", forma: "area" },
    attribution: 'DETER &copy; <a href="https://terrabrasilis.dpi.inpe.br/" target="_blank" rel="noopener">INPE/TerraBrasilis</a>',
    fonte: "INPE – DETER Cerrado (alertas diários, público)", licenca: "Dado público (CC BY-SA 4.0, INPE)", teste: TESTE_OK,
  },
  {
    id: "ucs", nome: "Unidades de Conservação (MMA/CNUC)", grupo: "sobreposicao", tipo: "wms",
    url: "https://geoservicos.inde.gov.br/geoserver/MMA/ows", layers: "MMA:cnuc_26_07_31", styles: "",
    minZoom: 6, opacidade: 0.55, legenda: { cor: "#65a30d", forma: "area" },
    attribution: 'UCs &copy; <a href="https://cnuc.mma.gov.br/" target="_blank" rel="noopener">MMA/CNUC</a> via INDE',
    fonte: "MMA – Cadastro Nacional de UCs (jul/2026)", licenca: "Dado público (MMA)", teste: TESTE_OK,
  },
  {
    id: "icmbio-embargos", nome: "Áreas embargadas (ICMBio)", grupo: "sobreposicao", tipo: "wms",
    url: "https://geoservicos.inde.gov.br/geoserver/ICMBio/ows", layers: "ICMBio:embargos_icmbio", styles: "",
    minZoom: 8, opacidade: 0.8, legenda: { cor: "#7c3aed", forma: "area" },
    attribution: 'Embargos &copy; <a href="https://www.gov.br/icmbio/" target="_blank" rel="noopener">ICMBio</a> via INDE',
    fonte: "ICMBio – áreas embargadas", licenca: "Dado público (ICMBio)", teste: TESTE_OK,
  },
];

export const ID_BASE_PADRAO = "esri-satelite";

export function camada(id: string): Camada | undefined {
  return CAMADAS.find((c) => c.id === id);
}

export function camadasBase(opts: { google: boolean; publico?: boolean }): Camada[] {
  return CAMADAS.filter((c) => c.grupo === "base" && (c.tipo !== "google" || (opts.google && !opts.publico)) && (!opts.publico || c.publico));
}

/** Sobreposições disponíveis: no mapa público nenhuma; camadas por UF só com UF; limite municipal só com código IBGE real. */
export function camadasSobreposicao(opts: { uf: string | null; codigoIbge?: string | null; publico?: boolean }): Camada[] {
  if (opts.publico) return [];
  return CAMADAS.filter((c) => c.grupo === "sobreposicao" && (!c.porUf || !!opts.uf) && (c.id !== "limite-municipio" || !!opts.codigoIbge));
}

/** Substitui {uf}/{UF}/{codigo_ibge} em url/layers. */
export function resolverModelo(texto: string, v: { uf?: string | null; codigoIbge?: string | null }): string {
  return texto
    .replaceAll("{uf}", (v.uf ?? "").toLowerCase())
    .replaceAll("{UF}", (v.uf ?? "").toUpperCase())
    .replaceAll("{codigo_ibge}", v.codigoIbge ?? "");
}

// ── Esri World Imagery Wayback (comparação antes/depois) ─────────────────────
// Releases validados (tile JPEG sem chave) – mesma lista do sistema Lem Urbanismo, conferida no oeste baiano em 28/09/2026.
// A data é a do *release* do mosaico, não necessariamente a da captura da imagem naquele local
// (quando o local não mudou, o servidor redireciona para o release que contém a imagem).
export const WAYBACK_RELEASES: readonly { release: number; data: string }[] = [
  { release: 26334, data: "2026-08-05" },
  { release: 10842, data: "2026-05-28" },
  { release: 22869, data: "2026-03-26" },
  { release: 36557, data: "2025-01-30" },
  { release: 16453, data: "2024-12-12" },
  { release: 56102, data: "2023-12-07" },
  { release: 45134, data: "2022-12-14" },
  { release: 26120, data: "2021-12-21" },
  { release: 29260, data: "2020-12-16" },
  { release: 4756, data: "2019-12-12" },
  { release: 239, data: "2018-11-29" },
  { release: 3319, data: "2017-07-14" },
  { release: 4222, data: "2016-10-25" },
  { release: 1431, data: "2015-09-16" },
  { release: 3026, data: "2014-07-02" },
  { release: 10, data: "2014-02-20" },
];

export function urlWayback(release: number): string {
  return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/{z}/{y}/{x}`;
}
export const ATTR_WAYBACK = 'Imagens históricas: <a href="https://livingatlas.arcgis.com/wayback/" target="_blank" rel="noopener">Esri World Imagery Wayback</a>';
