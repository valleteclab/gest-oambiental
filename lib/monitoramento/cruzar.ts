// Cruzamento do alerta com CAR e cadastro local – parte PURA (sem rede/banco), testada em tests/unit/monitoramento.test.ts.
import { extrairPoligono, type PoligonoGeo } from "../geo/validar";
import { areaHa, arredHa, intersecta, sobreposicaoHa } from "./geo";
import type { ImovelCruzado } from "./regras";

/** Imóvel do CAR como vem do WFS do SICAR (properties + geometry). */
export type FeicaoCar = { properties?: Record<string, unknown> | null; geometry?: unknown };

const ROTULO_SITUACAO: Record<string, string> = { AT: "Ativo", PE: "Pendente", SU: "Suspenso", CA: "Cancelado" };
const ROTULO_TIPO: Record<string, string> = { IRU: "Imóvel rural", AST: "Assentamento", PCT: "Povos e comunidades tradicionais" };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Imóveis do CAR com sobreposição real com o alerta (a consulta ao SICAR usa o retângulo do alerta, então
 * pode trazer vizinhos sem interseção). Ordenados pela maior sobreposição.
 */
export function imoveisCruzados(alerta: PoligonoGeo, feicoes: FeicaoCar[]): ImovelCruzado[] {
  const areaAlerta = areaHa(alerta);
  const vistos = new Set<string>();
  const r: ImovelCruzado[] = [];
  for (const f of feicoes) {
    const p = f.properties ?? {};
    const cod = typeof p.cod_imovel === "string" ? p.cod_imovel : null;
    if (!cod || vistos.has(cod)) continue;
    const g = extrairPoligono(f.geometry);
    if (!g) continue;
    const s = sobreposicaoHa(alerta, g);
    if (s <= 0.0001) continue;
    vistos.add(cod);
    const sit = String(p.status_imovel ?? "");
    r.push({
      cod_imovel: cod,
      area_imovel_ha: num(p.area),
      sobreposicao_ha: arredHa(s),
      percentual_alerta: areaAlerta > 0 ? Math.min(100, Math.round((s / areaAlerta) * 1000) / 10) : 0,
      situacao: ROTULO_SITUACAO[sit] ?? sit,
      condicao: typeof p.condicao === "string" ? p.condicao : null,
      tipo: ROTULO_TIPO[String(p.tipo_imovel ?? "")] ?? String(p.tipo_imovel ?? ""),
      municipio: String(p.municipio ?? ""),
    });
  }
  return r.sort((a, b) => b.sobreposicao_ha - a.sobreposicao_ha);
}

/** Normaliza o nº do CAR para comparação ("ba-2926202-abc.def" → "BA2926202ABCDEF"). */
export const normalizarCar = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export type EmpreendimentoLocal = { id: string; nome: string; numero_car: string | null; latitude: number | null; longitude: number | null; poligono_geojson: unknown };

/**
 * Empreendimentos do município relacionados ao alerta: mesmo nº do CAR de um imóvel intersectado (via "CAR"),
 * ou polígono do empreendimento que intersecta o alerta / ponto do empreendimento dentro do alerta (via "GEOMETRIA").
 */
export function empreendimentosRelacionados(alerta: PoligonoGeo | null, codsCar: string[], emps: EmpreendimentoLocal[]): { id: string; via: "CAR" | "GEOMETRIA" }[] {
  const cods = new Set(codsCar.map(normalizarCar).filter(Boolean));
  const r: { id: string; via: "CAR" | "GEOMETRIA" }[] = [];
  for (const e of emps) {
    if (e.numero_car && cods.has(normalizarCar(e.numero_car))) {
      r.push({ id: e.id, via: "CAR" });
      continue;
    }
    if (!alerta) continue;
    const pol = e.poligono_geojson ? extrairPoligono(e.poligono_geojson) : null;
    if (pol && intersecta(pol, alerta)) r.push({ id: e.id, via: "GEOMETRIA" });
    else if (!pol && e.latitude != null && e.longitude != null && intersecta({ type: "Point", coordinates: [e.longitude, e.latitude] }, alerta)) r.push({ id: e.id, via: "GEOMETRIA" });
  }
  return r;
}
