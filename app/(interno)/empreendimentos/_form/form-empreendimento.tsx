"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Mapa, type PoligonoGeo } from "@/components/mapa";
import { areaM2, validarPoligono } from "@/lib/geo/validar";
import { BuscaCar } from "./busca-car";
import { calcularPorte, PORTES, ROTULO_PORTE } from "@/lib/cadastros/porte";
import { salvarEmpreendimento } from "../actions";
import { useFormAcao, CampoSelect, CampoTexto, CamposEndereco, Erro, MensagemEstado } from "../../pessoas/_form/campos";

type Opc = { id: string; nome: string };
type Tip = { id: string; codigo: string; descricao: string; unidade_porte: string; faixas_porte: unknown; potencial_poluidor: string };
type Mun = Opc & { latitude: number | null; longitude: number | null };

export type ValorEmp = {
  id?: string;
  municipio_id?: string;
  requerente_id?: string;
  nome?: string;
  endereco?: Record<string, string | null> | null;
  latitude?: number | null;
  longitude?: number | null;
  poligono_geojson?: unknown;
  tipologia_id?: string;
  grandeza_porte?: number | null;
  porte?: string | null;
  porte_justificativa?: string | null;
  area_m2?: number | null;
  numero_car?: string | null;
  status?: "ATIVO" | "INATIVO";
  rt_id?: string | null;
};

const ROTULO_PP: Record<string, string> = { BAIXO: "Baixo", MEDIO: "Médio", ALTO: "Alto" };

export function FormEmpreendimento(props: { valor?: ValorEmp; municipios: Mun[]; requerentes: (Opc & { doc: string })[]; tipologias: Tip[]; rts: (Opc & { registro: string })[]; podeAjustarPorte: boolean }) {
  const { valor, municipios, requerentes, tipologias, rts, podeAjustarPorte } = props;
  const [estado, onSubmit, pendente] = useFormAcao(salvarEmpreendimento);
  const [municipioId, setMunicipioId] = useState(valor?.municipio_id ?? (municipios.length === 1 ? municipios[0].id : ""));
  const [lat, setLat] = useState<string>(valor?.latitude?.toString() ?? "");
  const [lng, setLng] = useState<string>(valor?.longitude?.toString() ?? "");
  const [tipId, setTipId] = useState(valor?.tipologia_id ?? "");
  const [grandeza, setGrandeza] = useState(valor?.grandeza_porte?.toString() ?? "");
  const tip = tipologias.find((t) => t.id === tipId);
  const calculado = useMemo(() => (tip ? calcularPorte(tip.faixas_porte, grandeza.replace(",", ".")) : null), [tip, grandeza]);
  const [ajustar, setAjustar] = useState(!!valor?.porte_justificativa);
  const [poligono, setPoligono] = useState(valor?.poligono_geojson ? JSON.stringify(valor.poligono_geojson, null, 2) : "");
  const poligonoObj = useMemo(() => {
    try {
      return poligono.trim() ? (JSON.parse(poligono) as GeoJSON.GeoJsonObject) : null;
    } catch {
      return null;
    }
  }, [poligono]);
  const [numeroCar, setNumeroCar] = useState(valor?.numero_car ?? "");
  const [area, setArea] = useState(valor?.area_m2?.toString() ?? "");
  const mun = municipios.find((m) => m.id === municipioId);
  // Sem coordenadas do município selecionado, o mapa centraliza no órgão ativo.
  const centro: [number, number] | undefined = mun?.latitude && mun?.longitude ? [mun.latitude, mun.longitude] : undefined;
  const sel: [number, number] | null = lat && lng && !isNaN(Number(lat)) && !isNaN(Number(lng)) ? [Number(lat), Number(lng)] : null;

  /** Polígono desenhado/importado/do CAR → GeoJSON do formulário + área (m²). */
  function aplicarPoligono(g: PoligonoGeo | null, m2?: number) {
    setPoligono(g ? JSON.stringify(g) : "");
    if (g) setArea(String(Math.round((m2 ?? areaM2(g)) * 100) / 100));
  }
  const erroPoligono = useMemo(() => {
    if (!poligono.trim() || !poligonoObj) return null;
    const r = validarPoligono(poligonoObj);
    return r.ok ? null : r.erro;
  }, [poligono, poligonoObj]);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {valor?.id && <input type="hidden" name="id" value={valor.id} />}
      <MensagemEstado estado={estado} />
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto className="sm:col-span-2" name="nome" label="Nome do empreendimento" required defaultValue={valor?.nome ?? ""} estado={estado} />
        <CampoSelect name="municipio_id" label="Município" required value={municipioId} onChange={(e) => setMunicipioId(e.target.value)} estado={estado} vazio="Selecione…" opcoes={municipios.map((m) => ({ valor: m.id, rotulo: m.nome }))} />
        <CampoSelect name="requerente_id" label="Requerente (titular)" required defaultValue={valor?.requerente_id ?? ""} estado={estado} vazio="Selecione…" opcoes={requerentes.map((r) => ({ valor: r.id, rotulo: `${r.nome} (${r.doc})` }))} dica="Não encontrou? Cadastre em Pessoas." />
        <CampoSelect name="rt_id" label="Responsável técnico atual" defaultValue={valor?.rt_id ?? ""} estado={estado} vazio="(nenhum)" opcoes={rts.map((r) => ({ valor: r.id, rotulo: `${r.nome} – ${r.registro}` }))} dica="Trocar o RT encerra o vínculo anterior (histórico)." />
        {valor?.id && <CampoSelect name="status" label="Situação" defaultValue={valor.status ?? "ATIVO"} estado={estado} opcoes={[{ valor: "ATIVO", rotulo: "Ativo" }, { valor: "INATIVO", rotulo: "Inativo" }]} />}
        <CampoTexto name="numero_car" label="Nº do CAR (se rural)" value={numeroCar} onChange={(e) => setNumeroCar(e.target.value)} estado={estado} dica="Pode ser preenchido pelo mapa: “Buscar imóvel no CAR neste ponto”." />
        <CampoTexto name="area_m2" label="Área total (m²)" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} estado={estado} dica="Preenchida automaticamente ao desenhar/importar o polígono." />
      </div>

      <fieldset className="grid gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-slate-800">Atividade e porte</legend>
        <CampoSelect className="sm:col-span-2" name="tipologia_id" label="Tipologia" required value={tipId} onChange={(e) => setTipId(e.target.value)} estado={estado} vazio="Selecione…" opcoes={tipologias.map((t) => ({ valor: t.id, rotulo: `${t.codigo} – ${t.descricao}` }))} />
        <CampoTexto name="grandeza_porte" label={`Grandeza${tip ? ` (${tip.unidade_porte})` : ""}`} required inputMode="decimal" value={grandeza} onChange={(e) => setGrandeza(e.target.value)} estado={estado} />
        <div className="text-sm" aria-live="polite">
          <span className="label">Porte calculado / potencial poluidor</span>
          <p className="py-2" data-testid="porte-calculado">
            <strong>{calculado ? ROTULO_PORTE[calculado] : "—"}</strong>
            {tip && <> · potencial {ROTULO_PP[tip.potencial_poluidor]}</>}
          </p>
        </div>
        {podeAjustarPorte && (
          <div className="sm:col-span-2 space-y-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="ajustar_porte" value="1" checked={ajustar} onChange={(e) => setAjustar(e.target.checked)} />
              Ajustar porte manualmente (técnico, com justificativa)
            </label>
            {ajustar && (
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <CampoSelect name="porte" label="Porte ajustado" defaultValue={valor?.porte ?? calculado ?? ""} estado={estado} opcoes={PORTES.map((p) => ({ valor: p, rotulo: ROTULO_PORTE[p] }))} />
                <div>
                  <label htmlFor="f-porte_justificativa" className="label">Justificativa <span className="text-red-700" aria-hidden>*</span></label>
                  <textarea id="f-porte_justificativa" name="porte_justificativa" rows={2} className="input" defaultValue={valor?.porte_justificativa ?? ""} aria-describedby="f-porte_justificativa-erro" />
                  <Erro id="f-porte_justificativa-erro" msg={estado?.campos?.porte_justificativa} />
                </div>
              </div>
            )}
          </div>
        )}
      </fieldset>

      <CamposEndereco valor={valor?.endereco} estado={estado} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-800">Localização</legend>
        <p className="text-xs text-slate-600">Clique no mapa para marcar o ponto do empreendimento ou digite as coordenadas (graus decimais, WGS84).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoTexto name="latitude" label="Latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} estado={estado} placeholder="-12.527500" />
          <CampoTexto name="longitude" label="Longitude" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} estado={estado} placeholder="-40.306700" />
        </div>
        <Mapa
          key={municipioId}
          centro={centro}
          zoom={sel ? 15 : 12}
          altura="min(60vh, 440px)"
          selecionavel
          selecionado={sel}
          camadasIniciais={["esri-rotulos", "car"]}
          editavelPoligono
          poligono={poligonoObj}
          onPoligono={aplicarPoligono}
          onSelecionar={(a, b) => { setLat(String(a)); setLng(String(b)); }}
        />
        <p className="text-xs text-slate-600">
          Camadas (canto superior direito): satélite, CAR/SICAR (a partir do zoom 11), SIGEF, IBGE, PRODES/DETER, UCs. Desenhe o polígono com as ferramentas à esquerda ou importe um arquivo.
        </p>
        <BuscaCar ponto={sel} onUsarCar={setNumeroCar} onUsarPoligono={(g) => aplicarPoligono(g)} />
        <input type="hidden" name="poligono_geojson" value={poligono} />
        <Erro id="f-poligono-erro" msg={estado?.campos?.poligono_geojson} />
        {erroPoligono && <span className="block text-xs text-amber-700">Polígono: {erroPoligono}</span>}
        <div className="flex flex-wrap items-center gap-2">
          {poligono && <button type="button" className="btn-secundario btn-sm" onClick={() => setPoligono("")}>Remover polígono</button>}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-700">Editar GeoJSON do polígono (avançado)</summary>
          <label htmlFor="f-poligono" className="label mt-2">Polígono (GeoJSON Polygon/MultiPolygon, WGS84)</label>
          <textarea id="f-poligono" rows={5} className="input font-mono text-xs" value={poligono} onChange={(e) => setPoligono(e.target.value)} placeholder='{"type":"Polygon","coordinates":[[[-40.3,-12.5],[-40.29,-12.5],[-40.29,-12.51],[-40.3,-12.5]]]}' aria-describedby="f-poligono-erro" />
          {poligono.trim() && !poligonoObj && <span className="mt-1 block text-xs text-amber-700">JSON ainda inválido.</span>}
        </details>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" disabled={pendente}>{pendente ? "Salvando…" : "Salvar"}</button>
        <Link href={valor?.id ? `/empreendimentos/${valor.id}` : "/empreendimentos"} className="btn-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
