"use client";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { camadasBase, camadasSobreposicao, ID_BASE_PADRAO, resolverModelo, ZOOM_MAXIMO, type Camada } from "@/lib/geo/camadas";
import { lerPreferencia, salvarPreferencia, type ConfigMapas } from "./config-cliente";
import { aoFalharChaveGoogle, carregarGoogleMutant, googleFalhou } from "./google";

// Seletor de camadas (L.control.layers) com as bases e sobreposições do catálogo lib/geo/camadas.ts.
// Bases: Satélite Esri (padrão), OSM e – com GOOGLE_MAPS_KEY – Google Satélite/Híbrido/Ruas.
// Sobreposições: só são requisitadas quando ligadas (e acima do minZoom de cada uma).

const CHAVE_BASE = "lg_mapa_base";
export const PANE_SOBREPOSICOES = "lgSobreposicoes";

type Ctx = { uf: string | null; codigoIbge: string | null };

function criarCamada(c: Camada, ctx: Ctx, aoErro: (id: string) => void): L.Layer {
  if (c.tipo === "xyz") {
    return L.tileLayer(c.url, {
      maxZoom: ZOOM_MAXIMO, maxNativeZoom: c.maxNativeZoom, minZoom: c.minZoom, opacity: c.opacidade ?? 1, attribution: c.attribution,
      ...(c.grupo === "sobreposicao" ? { pane: PANE_SOBREPOSICOES } : {}),
    });
  }
  if (c.tipo === "wms") {
    const l = L.tileLayer.wms(resolverModelo(c.url, ctx), {
      layers: resolverModelo(c.layers ?? "", ctx), styles: c.styles ?? "", format: "image/png", transparent: true, version: "1.1.1",
      tileSize: 512, maxZoom: ZOOM_MAXIMO, minZoom: c.minZoom, opacity: c.opacidade ?? 1, attribution: c.attribution, pane: PANE_SOBREPOSICOES,
    });
    // Serviços públicos oscilam: só avisa se vários tiles falharem sem nenhum carregar.
    let falhas = 0;
    let cargas = 0;
    l.on("tileload", () => (cargas += 1));
    l.on("tileerror", () => {
      falhas += 1;
      if (falhas >= 3 && cargas === 0) aoErro(c.id);
    });
    return l;
  }
  // geojson (limite do município) – carregado no primeiro "add"
  const cor = c.legenda?.cor ?? "#f59e0b";
  const g = L.geoJSON(undefined, { style: { color: cor, weight: 3, dashArray: "8 6", fill: false }, interactive: false, pmIgnore: true } as L.GeoJSONOptions);
  let carregado = false;
  g.on("add", () => {
    if (carregado) return;
    carregado = true;
    fetch(resolverModelo(c.url, ctx), { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => g.addData(d))
      .catch(() => {
        carregado = false;
        aoErro(c.id);
      });
  });
  g.getAttribution = () => c.attribution;
  return g;
}

export function ControleCamadas(props: {
  publico?: boolean;
  config: ConfigMapas | null;
  camadasIniciais?: string[];
  onAtivas?: (ids: string[]) => void;
  onErro?: (id: string) => void;
}) {
  const { publico, config } = props;
  const map = useMap();
  const ctrlRef = useRef<L.Control.Layers | null>(null);
  const basesRef = useRef(new Map<string, L.Layer>());
  const overlaysRef = useRef(new Map<string, { layer: L.Layer; chave: string }>());
  const cbRef = useRef(props);
  cbRef.current = props;

  // 1) Bases fixas + controle (uma vez por mapa)
  useEffect(() => {
    if (!map.getPane(PANE_SOBREPOSICOES)) {
      const p = map.createPane(PANE_SOBREPOSICOES);
      p.style.zIndex = "350"; // acima das bases (200), abaixo de vetores/marcadores (400+)
      p.style.pointerEvents = "none";
    }
    const bases = basesRef.current;
    const overlays = overlaysRef.current;
    const ctrl = L.control.layers(undefined, undefined, { position: "topright", collapsed: true, sortLayers: false });
    for (const c of camadasBase({ google: false, publico })) {
      const l = criarCamada(c, { uf: null, codigoIbge: null }, () => {});
      bases.set(c.id, l);
      ctrl.addBaseLayer(l, c.nome);
    }
    const pref = lerPreferencia(CHAVE_BASE);
    (bases.get(pref ?? "") ?? bases.get(ID_BASE_PADRAO)!).addTo(map);
    ctrl.addTo(map);
    ctrlRef.current = ctrl;

    const idDe = (layer: L.Layer, mapa: Map<string, L.Layer> | Map<string, { layer: L.Layer }>) => {
      for (const [id, v] of mapa) if ((v as { layer?: L.Layer }).layer === layer || v === layer) return id;
      return null;
    };
    const aoTrocarBase = (e: L.LayersControlEvent) => salvarPreferencia(CHAVE_BASE, idDe(e.layer, bases));
    const avisarAtivas = () => cbRef.current.onAtivas?.([...overlays].filter(([, v]) => map.hasLayer(v.layer)).map(([id]) => id));
    map.on("baselayerchange", aoTrocarBase);
    map.on("overlayadd overlayremove", avisarAtivas);
    return () => {
      map.off("baselayerchange", aoTrocarBase);
      map.off("overlayadd overlayremove", avisarAtivas);
      ctrl.remove();
      bases.forEach((l) => map.removeLayer(l));
      overlays.forEach((v) => map.removeLayer(v.layer));
      bases.clear();
      overlays.clear();
      ctrlRef.current = null;
    };
  }, [map, publico]);

  // 2) Sobreposições (dependem da UF / município do órgão ativo)
  const uf = config?.uf ?? null;
  const codigoIbge = config?.orgao?.codigo_ibge ?? null;
  const iniciais = (props.camadasIniciais ?? ["esri-rotulos"]).join(",");
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const ctx = { uf, codigoIbge };
    const overlays = overlaysRef.current;
    const desejadas = camadasSobreposicao({ uf, codigoIbge, publico });
    const ids = new Set(desejadas.map((c) => c.id));
    for (const [id, v] of overlays) {
      if (!ids.has(id)) {
        ctrl.removeLayer(v.layer);
        map.removeLayer(v.layer);
        overlays.delete(id);
      }
    }
    const ligar = new Set(iniciais.split(","));
    for (const c of desejadas) {
      const chave = `${resolverModelo(c.url, ctx)}|${resolverModelo(c.layers ?? "", ctx)}`;
      const atual = overlays.get(c.id);
      if (atual?.chave === chave) continue;
      const estavaLigada = atual ? map.hasLayer(atual.layer) : ligar.has(c.id);
      if (atual) {
        ctrl.removeLayer(atual.layer);
        map.removeLayer(atual.layer);
      }
      const layer = criarCamada(c, ctx, (id) => cbRef.current.onErro?.(id));
      overlays.set(c.id, { layer, chave });
      ctrl.addOverlay(layer, c.nome);
      if (estavaLigada) layer.addTo(map);
    }
    cbRef.current.onAtivas?.([...overlays].filter(([, v]) => map.hasLayer(v.layer)).map(([id]) => id));
  }, [map, uf, codigoIbge, publico, iniciais]);

  // 3) Google (somente com chave configurada no servidor; volta para Esri se o Google recusar a chave)
  const chave = publico ? null : (config?.google_maps_key ?? null);
  useEffect(() => {
    if (!chave || googleFalhou()) return;
    let vivo = true;
    const google = new Map<string, L.Layer>();
    const remover = (falhou: boolean) => {
      const bases = basesRef.current;
      let estavaAtiva = false;
      google.forEach((l, id) => {
        if (map.hasLayer(l)) {
          estavaAtiva = true;
          map.removeLayer(l);
        }
        ctrlRef.current?.removeLayer(l);
        bases.delete(id);
      });
      google.clear();
      if (estavaAtiva && falhou) {
        bases.get(ID_BASE_PADRAO)?.addTo(map);
        salvarPreferencia(CHAVE_BASE, null);
      }
    };
    const soltar = aoFalharChaveGoogle(() => remover(true));
    carregarGoogleMutant(chave)
      .then((GoogleMutant) => {
        if (!vivo || !ctrlRef.current || googleFalhou()) return;
        const semPoi = [{ featureType: "poi", stylers: [{ visibility: "off" }] }, { featureType: "transit", stylers: [{ visibility: "off" }] }];
        for (const c of camadasBase({ google: true, publico: false }).filter((x) => x.tipo === "google")) {
          const l = new GoogleMutant({ type: c.googleTipo, maxZoom: ZOOM_MAXIMO, ...(c.googleTipo === "satellite" ? {} : { styles: semPoi }) });
          google.set(c.id, l);
          basesRef.current.set(c.id, l);
          ctrlRef.current.addBaseLayer(l, c.nome);
        }
        const pref = lerPreferencia(CHAVE_BASE);
        const escolhida = pref ? google.get(pref) : undefined;
        if (escolhida) {
          basesRef.current.forEach((l, id) => {
            if (!google.has(id) && map.hasLayer(l)) map.removeLayer(l);
          });
          escolhida.addTo(map);
        }
      })
      .catch((e) => console.warn("Google Maps indisponível, mantendo Esri:", e instanceof Error ? e.message : e));
    return () => {
      vivo = false;
      soltar();
      remover(false);
    };
  }, [map, chave]);

  return null;
}
