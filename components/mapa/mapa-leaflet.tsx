"use client";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";
import { MapContainer, Marker, Popup, useMapEvents, GeoJSON, ScaleControl, useMap } from "react-leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZOOM_MAXIMO } from "@/lib/geo/camadas";
import { areaM2, extrairPoligono, m2ParaHa, type PoligonoGeo } from "@/lib/geo/validar";
import { fmtNumero } from "@/lib/format";
import { useConfigMapas } from "./config-cliente";
import { ControleCamadas } from "./controle-camadas";
import { LegendaMapa } from "./legenda";
import { DesenhoPoligono } from "./desenho";
import { ACEITA_IMPORTACAO, importarPoligono } from "./importar";

// Ícone padrão sem depender de assets do bundler
export const icone = (cor = "#065f46") =>
  L.divIcon({
    className: "",
    html: `<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 25 13 25s13-15.2 13-25C26 5.8 20.2 0 13 0z" fill="${cor}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>`,
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
  });

/** Marcadores não participam do desenho (Geoman) – não podem ser arrastados/apagados pelas ferramentas de polígono. */
const SEM_PM = { pmIgnore: true } as object;

export type PontoMapa = { id: string; lat: number; lng: number; titulo: string; descricao?: string; href?: string; cor?: string };

export type PropsMapa = {
  /** Centro inicial. Sem centro (e sem ponto selecionado/pontos), usa o município do órgão ativo. */
  centro?: [number, number];
  zoom?: number;
  pontos?: PontoMapa[];
  altura?: string;
  /** Modo seleção: clique marca um ponto e chama onSelecionar */
  selecionavel?: boolean;
  selecionado?: [number, number] | null;
  onSelecionar?: (lat: number, lng: number) => void;
  poligono?: GeoJSON.GeoJsonObject | null;
  // ── Opcionais (camadas, desenho) ──
  /** Mapa público (portal): só Satélite Esri e OSM, sem Google e sem camadas governamentais. */
  publico?: boolean;
  /** Sobreposições ligadas ao abrir (ids de lib/geo/camadas.ts). Padrão: ["esri-rotulos"]. */
  camadasIniciais?: string[];
  /** Permite desenhar/editar o polígono (Geoman) e importar KML/KMZ/GeoJSON/SHP. */
  editavelPoligono?: boolean;
  /** Chamado ao desenhar, editar, importar ou apagar o polígono (null ao apagar). */
  onPoligono?: (geojson: PoligonoGeo | null, areaM2: number) => void;
};

function Clique({ onSelecionar }: { onSelecionar?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      // Durante o desenho/edição do polígono o clique não move o ponto.
      const pm = (e.target as { pm?: { globalDrawModeEnabled?: () => boolean; globalEditModeEnabled?: () => boolean; globalRemovalModeEnabled?: () => boolean } }).pm;
      if (pm?.globalDrawModeEnabled?.() || pm?.globalEditModeEnabled?.() || pm?.globalRemovalModeEnabled?.()) return;
      onSelecionar?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    },
  });
  return null;
}

/** Centraliza no município do órgão ativo quando a página não informou centro. */
function CentroOrgao({ centro, zoom }: { centro: [number, number] | null; zoom: number }) {
  const map = useMap();
  const feito = useRef(false);
  useEffect(() => {
    if (!centro || feito.current) return;
    feito.current = true;
    map.setView(centro, Math.max(zoom, 12));
  }, [map, centro, zoom]);
  return null;
}

/** Ponto selecionado alterado por fora (coordenadas digitadas, GPS): traz o ponto para a vista. */
function SeguirSelecionado({ ponto }: { ponto: [number, number] }) {
  const map = useMap();
  const [lat, lng] = ponto;
  useEffect(() => {
    if (!map.getBounds().contains([lat, lng])) map.panTo([lat, lng]);
  }, [map, lat, lng]);
  return null;
}

/** Enquadra o polígono (somente leitura) na primeira exibição. */
function EnquadrarPoligono({ poligono }: { poligono: GeoJSON.GeoJsonObject }) {
  const map = useMap();
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    const b = L.geoJSON(poligono).getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [20, 20], maxZoom: 17 });
  }, [map, poligono]);
  return null;
}

export default function MapaLeaflet(props: PropsMapa) {
  const { centro, zoom = 8, pontos = [], altura = "400px", selecionavel, selecionado, onSelecionar, poligono, publico, camadasIniciais, editavelPoligono, onPoligono } = props;
  const cfg = useConfigMapas(!publico);
  const [ativas, setAtivas] = useState<string[]>([]);
  const [erros, setErros] = useState<Record<string, true>>({});
  const onErro = useCallback((id: string) => setErros((e) => (e[id] ? e : { ...e, [id]: true })), []);
  const [erroImport, setErroImport] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  const semCentro = !centro && !selecionado && pontos.length === 0;
  const centroOrgao = semCentro && cfg?.orgao?.centro ? cfg.orgao.centro : null;
  const inicial: [number, number] = selecionado ?? centro ?? [-12.45, -40.2];
  const chavePoligono = useMemo(() => (poligono ? JSON.stringify(poligono).length + ":" + JSON.stringify(poligono).slice(0, 200) : ""), [poligono]);
  const area = useMemo(() => {
    if (!editavelPoligono || !poligono) return null;
    const g = extrairPoligono(poligono);
    return g ? areaM2(g) : null;
  }, [editavelPoligono, poligono]);

  async function importar(f: File | undefined) {
    if (!f) return;
    setErroImport(null);
    setImportando(true);
    const r = await importarPoligono(f);
    setImportando(false);
    if (!r.ok) return setErroImport(r.erro);
    onPoligono?.(r.geometria, r.areaM2);
  }

  return (
    <div>
      <MapContainer center={inicial} zoom={zoom} maxZoom={ZOOM_MAXIMO} style={{ height: altura, width: "100%" }} className="z-0 rounded-md border border-slate-200">
        <ControleCamadas publico={publico} config={cfg} camadasIniciais={camadasIniciais} onAtivas={setAtivas} onErro={onErro} />
        <ScaleControl position="bottomright" imperial={false} />
        {semCentro && <CentroOrgao centro={centroOrgao} zoom={zoom} />}
        {pontos.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={icone(p.cor)} title={p.titulo} {...SEM_PM}>
            <Popup>
              <strong>{p.titulo}</strong>
              {p.descricao && <div>{p.descricao}</div>}
              {p.href && <a href={p.href}>Abrir ficha</a>}
            </Popup>
          </Marker>
        ))}
        {selecionavel && <Clique onSelecionar={onSelecionar} />}
        {selecionado && <Marker position={selecionado} icon={icone("#b91c1c")} title="Ponto selecionado" {...SEM_PM} />}
        {selecionado && <SeguirSelecionado ponto={selecionado} />}
        {editavelPoligono ? (
          <DesenhoPoligono poligono={poligono} onPoligono={onPoligono} />
        ) : (
          poligono && (
            <>
              <GeoJSON key={chavePoligono} data={poligono} style={{ color: "#facc15", weight: 3, fillOpacity: 0.15 }} {...SEM_PM} />
              {!selecionado && <EnquadrarPoligono poligono={poligono} />}
            </>
          )
        )}
        {!publico && <LegendaMapa ativas={ativas} erros={erros} />}
      </MapContainer>
      {editavelPoligono && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="btn-secundario btn-sm cursor-pointer">
            {importando ? "Lendo arquivo…" : "Importar polígono (KML, KMZ, GeoJSON, SHP .zip)"}
            <input type="file" accept={ACEITA_IMPORTACAO} className="sr-only" data-testid="mapa-importar" onChange={(e) => { void importar(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <span className="text-xs text-slate-600">Ou desenhe com as ferramentas à esquerda do mapa.</span>
          {area != null && <span className="ml-auto text-sm" data-testid="mapa-area">Área do polígono: <strong>{fmtNumero(m2ParaHa(area), 4)} ha</strong> ({fmtNumero(area, 0)} m²)</span>}
          {erroImport && <span className="block w-full text-xs text-red-700" role="alert">{erroImport}</span>}
        </div>
      )}
    </div>
  );
}
