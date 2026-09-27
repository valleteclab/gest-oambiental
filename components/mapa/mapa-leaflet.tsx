"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, GeoJSON } from "react-leaflet";
import { useEffect } from "react";

// Ícone padrão sem depender de assets do bundler
const icone = (cor = "#065f46") =>
  L.divIcon({
    className: "",
    html: `<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 25 13 25s13-15.2 13-25C26 5.8 20.2 0 13 0z" fill="${cor}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>`,
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
  });

export type PontoMapa = { id: string; lat: number; lng: number; titulo: string; descricao?: string; href?: string; cor?: string };

export type PropsMapa = {
  centro?: [number, number];
  zoom?: number;
  pontos?: PontoMapa[];
  altura?: string;
  /** Modo seleção: clique marca um ponto e chama onSelecionar */
  selecionavel?: boolean;
  selecionado?: [number, number] | null;
  onSelecionar?: (lat: number, lng: number) => void;
  poligono?: GeoJSON.GeoJsonObject | null;
};

function Clique({ onSelecionar }: { onSelecionar?: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onSelecionar?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}

export default function MapaLeaflet({ centro = [-12.45, -40.2], zoom = 8, pontos = [], altura = "400px", selecionavel, selecionado, onSelecionar, poligono }: PropsMapa) {
  useEffect(() => {}, []);
  return (
    <MapContainer center={selecionado ?? centro} zoom={zoom} style={{ height: altura, width: "100%" }} className="z-0 rounded-md border border-slate-200">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {pontos.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={icone(p.cor)} title={p.titulo}>
          <Popup>
            <strong>{p.titulo}</strong>
            {p.descricao && <div>{p.descricao}</div>}
            {p.href && <a href={p.href}>Abrir ficha</a>}
          </Popup>
        </Marker>
      ))}
      {selecionavel && <Clique onSelecionar={onSelecionar} />}
      {selecionado && <Marker position={selecionado} icon={icone("#b91c1c")} />}
      {poligono && <GeoJSON data={poligono} />}
    </MapContainer>
  );
}
