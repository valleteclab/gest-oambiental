"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, ScaleControl } from "react-leaflet";
import { useEffect, useState } from "react";
import { camada, ATTR_WAYBACK, urlWayback, WAYBACK_RELEASES, ZOOM_MAXIMO } from "@/lib/geo/camadas";
import { fmtData } from "@/lib/format";
import { icone } from "./mapa-leaflet";

// Comparação antes/depois: dois mapas sincronizados (lado a lado; empilhados no celular),
// cada um com uma data do Esri World Imagery Wayback ou a imagem atual.

export type PropsComparar = { lat: number; lng: number; zoom?: number; titulo?: string };

const ATUAL = "atual";
const esri = camada("esri-satelite")!;

function urlDe(valor: string) {
  return valor === ATUAL ? esri.url : urlWayback(Number(valor));
}

function Painel({ id, rotulo, valor, onValor, lat, lng, zoom, titulo, onMapa }: { id: string; rotulo: string; valor: string; onValor: (v: string) => void; lat: number; lng: number; zoom: number; titulo?: string; onMapa: (m: L.Map | null) => void }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">{rotulo}</label>
      <select id={id} className="input mb-2" value={valor} onChange={(e) => onValor(e.target.value)}>
        <option value={ATUAL}>Imagem atual (Esri World Imagery)</option>
        {WAYBACK_RELEASES.map((w) => (
          <option key={w.release} value={String(w.release)}>Wayback – versão de {fmtData(w.data + "T12:00:00")}</option>
        ))}
      </select>
      <MapContainer ref={onMapa} center={[lat, lng]} zoom={zoom} maxZoom={ZOOM_MAXIMO} style={{ height: "min(55vh, 420px)", width: "100%" }} className="z-0 rounded-md border border-slate-200">
        {/* Base atual por baixo: se faltar tile na data escolhida, o mapa não fica cinza. */}
        <TileLayer url={esri.url} maxNativeZoom={esri.maxNativeZoom} maxZoom={ZOOM_MAXIMO} attribution={esri.attribution} />
        {valor !== ATUAL && <TileLayer key={valor} url={urlDe(valor)} maxNativeZoom={17} maxZoom={ZOOM_MAXIMO} attribution={ATTR_WAYBACK} />}
        <ScaleControl position="bottomright" imperial={false} />
        <Marker position={[lat, lng]} icon={icone("#b91c1c")} title={titulo ?? "Local"} />
      </MapContainer>
    </div>
  );
}

export default function CompararLeaflet({ lat, lng, zoom = 16, titulo }: PropsComparar) {
  const [antes, setAntes] = useState(String(WAYBACK_RELEASES[WAYBACK_RELEASES.length - 1].release));
  const [depois, setDepois] = useState(ATUAL);
  const [mapaA, setMapaA] = useState<L.Map | null>(null);
  const [mapaB, setMapaB] = useState<L.Map | null>(null);
  const [sincronizar, setSincronizar] = useState(true);

  useEffect(() => {
    if (!mapaA || !mapaB || !sincronizar) return;
    let travado = false;
    const ligar = (origem: L.Map, destino: L.Map) => () => {
      if (travado) return;
      travado = true;
      destino.setView(origem.getCenter(), origem.getZoom(), { animate: false });
      travado = false;
    };
    const aParaB = ligar(mapaA, mapaB);
    const bParaA = ligar(mapaB, mapaA);
    mapaA.on("move", aParaB);
    mapaB.on("move", bParaA);
    aParaB();
    return () => {
      mapaA.off("move", aParaB);
      mapaB.off("move", bParaA);
    };
  }, [mapaA, mapaB, sincronizar]);

  // Recalcula o tamanho quando o layout muda (empilhado ↔ lado a lado)
  useEffect(() => {
    const f = () => {
      mapaA?.invalidateSize();
      mapaB?.invalidateSize();
    };
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [mapaA, mapaB]);

  function centralizar() {
    mapaA?.setView([lat, lng], zoom);
    if (!sincronizar) mapaB?.setView([lat, lng], zoom);
  }

  return (
    <div data-testid="comparar-imagens">
      <div className="grid gap-4 md:grid-cols-2">
        <Painel id="cmp-antes" rotulo="Antes" valor={antes} onValor={setAntes} lat={lat} lng={lng} zoom={zoom} titulo={titulo} onMapa={setMapaA} />
        <Painel id="cmp-depois" rotulo="Depois" valor={depois} onValor={setDepois} lat={lat} lng={lng} zoom={zoom} titulo={titulo} onMapa={setMapaB} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={sincronizar} onChange={(e) => setSincronizar(e.target.checked)} /> Sincronizar movimento e zoom</label>
        <button type="button" className="btn-secundario btn-sm" onClick={centralizar}>Voltar ao ponto</button>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        As datas são as das versões do mosaico Esri World Imagery Wayback; a imagem de um local pode ser anterior à versão (quando não houve atualização ali, versões diferentes mostram a mesma imagem).
        Resolução máxima nativa até o zoom 17.
      </p>
    </div>
  );
}
