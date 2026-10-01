import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { converterDeter, converterMapbiomas, converterProdes, nomeMunicipioInpe, normalizarNome, urlDeterPorMunicipio, urlProdesPorBbox } from "@/lib/monitoramento/fontes";
import { areaHa, simplificarGeometria, sobreposicaoHa, wktBbox, bboxDe } from "@/lib/monitoramento/geo";
import { empreendimentosRelacionados, imoveisCruzados, normalizarCar } from "@/lib/monitoramento/cruzar";
import { deveNotificar, documentoQueAutoriza, indicadores, podeTransicionarAlerta, sugerirStatus, type Cruzamento, type DocumentoCruzado } from "@/lib/monitoramento/regras";
import type { PoligonoGeo } from "@/lib/geo/validar";

const amostra = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/inpe-alertas-amostra.json"), "utf8"));

/** Quadrado de `lado` graus a partir de (lng, lat). */
const quadrado = (lng: number, lat: number, lado: number): PoligonoGeo => ({
  type: "Polygon",
  coordinates: [[[lng, lat], [lng + lado, lat], [lng + lado, lat + lado], [lng, lat + lado], [lng, lat]]],
});

describe("fontes – DETER/PRODES (fixture real do INPE)", () => {
  it("converte feições do DETER: id (gid), data, área do município em ha, geometria e centroide", () => {
    const [f1, f2] = amostra.deter.features;
    const a = converterDeter(f1)!;
    expect(a.fonte).toBe("DETER");
    expect(a.id_externo).toBe(f1.properties.gid);
    expect(a.classe).toBe("DESMATAMENTO_CR");
    expect(a.data_deteccao).toBe(f1.properties.view_date);
    expect(a.area_ha).toBeCloseTo(f1.properties.areamunkm * 100, 3);
    expect(["Polygon", "MultiPolygon"]).toContain(a.geometria!.type);
    // Oeste baiano
    expect(a.latitude).toBeGreaterThan(-12.1);
    expect(a.latitude).toBeLessThan(-11.3);
    expect(a.longitude).toBeGreaterThan(-46.2);
    expect(a.longitude).toBeLessThan(-44.6);
    // Área calculada do polígono ≈ área informada pelo INPE (±15%)
    expect(areaHa(a.geometria!)).toBeGreaterThan(a.area_ha * 0.85);
    expect(areaHa(a.geometria!)).toBeLessThan(a.area_ha * 1.15);
    expect(a.dados_fonte.municipality).toBe("RIACHÃO DAS NEVES");
    expect(converterDeter(f2)!.id_externo).not.toBe(a.id_externo);
  });

  it("converte feição do PRODES (uuid, classe dAAAA, image_date)", () => {
    const f = amostra.prodes.features[0];
    const a = converterProdes(f)!;
    expect(a.fonte).toBe("PRODES");
    expect(a.id_externo).toBe(f.properties.uuid);
    expect(a.classe).toBe(f.properties.class_name);
    expect(a.data_deteccao).toBe(f.properties.image_date);
    expect(a.area_ha).toBeCloseTo(f.properties.area_km * 100, 3);
  });

  it("descarta feições sem id, data ou geometria", () => {
    expect(converterDeter({ properties: { gid: "1_curr" }, geometry: null })).toBeNull();
    expect(converterDeter({ properties: { view_date: "2026-01-01" }, geometry: quadrado(-45, -12, 0.01) })).toBeNull();
    expect(converterProdes({ properties: { uuid: "x" }, geometry: quadrado(-45, -12, 0.01) })).toBeNull();
  });

  it("PRODES sem image_date usa 01/08 do ano PRODES", () => {
    expect(converterProdes({ properties: { uuid: "u1", year: 2025, main_class: "DESMATAMENTO" }, geometry: quadrado(-45, -12, 0.01) })!.data_deteccao).toBe("2025-08-01");
  });

  it("MapBiomas (opcional): bbox vira retângulo aproximado", () => {
    const a = converterMapbiomas({ alertCode: 123, areaHa: 12.5, detectedAt: "2026-05-02T00:00:00Z", boundingBox: [-45.1, -11.9, -45.09, -11.89] })!;
    expect(a.id_externo).toBe("123");
    expect(a.data_deteccao).toBe("2026-05-02");
    expect(a.geometria!.type).toBe("Polygon");
    expect(a.dados_fonte.geometria_aproximada).toBe(true);
  });

  it("URLs WFS: nome em maiúsculas com acento, aspas escapadas, bbox e ano", () => {
    expect(nomeMunicipioInpe("Riachão das Neves")).toBe("RIACHÃO DAS NEVES");
    expect(normalizarNome("Luís Eduardo Magalhães")).toBe("LUIS EDUARDO MAGALHAES");
    const u = new URL(urlDeterPorMunicipio("Pau d'Arco", "to", "2024-09-28"));
    expect(u.searchParams.get("CQL_FILTER")).toBe("municipality='PAU D''ARCO' AND uf='TO' AND view_date>='2024-09-28'");
    expect(u.searchParams.get("typeName")).toBe("deter-cerrado-nb:deter_cerrado");
    expect(new URL(urlProdesPorBbox([-46.1, -12, -44.6, -11.3], 2024)).searchParams.get("CQL_FILTER")).toBe("BBOX(geom,-46.1,-12,-44.6,-11.3) AND year>=2024 AND main_class='DESMATAMENTO'");
  });
});

describe("geometria – simplificação e sobreposição", () => {
  it("simplifica até caber no limite de bytes", () => {
    const n = 4000;
    const anel = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return [-45 + Math.cos(t) * 0.05 + Math.sin(t * 37) * 0.0003, -12 + Math.sin(t) * 0.05] as [number, number];
    });
    anel.push(anel[0]);
    const g: PoligonoGeo = { type: "Polygon", coordinates: [anel] };
    expect(JSON.stringify(g).length).toBeGreaterThan(20_000);
    const s = simplificarGeometria(g, 20_000)!;
    expect(JSON.stringify(s).length).toBeLessThanOrEqual(20_000);
    expect(areaHa(s)).toBeCloseTo(areaHa(g), -2);
  });

  it("sobreposição: metade do quadrado dentro do imóvel ≈ 50% da área", () => {
    const alerta = quadrado(-45, -12, 0.01);
    const imovel = quadrado(-44.995, -12.02, 0.05); // cobre a metade leste do alerta
    const s = sobreposicaoHa(alerta, imovel);
    expect(s / areaHa(alerta)).toBeCloseTo(0.5, 2);
    expect(sobreposicaoHa(alerta, quadrado(-40, -12, 0.01))).toBe(0);
  });

  it("wkt do retângulo (lon lat)", () => {
    expect(wktBbox(bboxDe(quadrado(-45, -12, 1)))).toBe("POLYGON((-45 -12,-44 -12,-44 -11,-45 -11,-45 -12))");
  });

  it("imóveis do CAR: só os que sobrepõem, ordenados pela maior sobreposição, sem duplicatas", () => {
    const alerta = quadrado(-45, -12, 0.01);
    const feicoes = [
      { properties: { cod_imovel: "BA-1-A", area: 100, status_imovel: "AT", tipo_imovel: "IRU" }, geometry: quadrado(-44.998, -12.02, 0.05) },
      { properties: { cod_imovel: "BA-1-B", area: 50, status_imovel: "PE", tipo_imovel: "AST" }, geometry: quadrado(-45.02, -12.02, 0.021) },
      { properties: { cod_imovel: "BA-1-A" }, geometry: quadrado(-45, -12, 0.01) },
      { properties: { cod_imovel: "BA-1-FORA" }, geometry: quadrado(-44.9, -12, 0.01) }, // no bbox da consulta, sem interseção
    ];
    const r = imoveisCruzados(alerta, feicoes);
    expect(r.map((i) => i.cod_imovel)).toEqual(["BA-1-A", "BA-1-B"]);
    expect(r[0].percentual_alerta).toBeCloseTo(80, 0);
    expect(r[0].situacao).toBe("Ativo");
    expect(r[1].tipo).toBe("Assentamento");
  });

  it("empreendimentos relacionados por nº do CAR (normalizado) ou localização", () => {
    const alerta = quadrado(-45, -12, 0.01);
    expect(normalizarCar("ba-2926202-abc.DEF")).toBe("BA2926202ABCDEF");
    const r = empreendimentosRelacionados(alerta, ["BA-2926202-ABCDEF"], [
      { id: "e1", nome: "Por CAR", numero_car: "ba-2926202-abcdef", latitude: null, longitude: null, poligono_geojson: null },
      { id: "e2", nome: "Ponto dentro", numero_car: null, latitude: -11.995, longitude: -44.995, poligono_geojson: null },
      { id: "e3", nome: "Polígono", numero_car: "OUTRO", latitude: 0, longitude: 0, poligono_geojson: quadrado(-45.005, -12.005, 0.01) },
      { id: "e4", nome: "Longe", numero_car: null, latitude: -10, longitude: -40, poligono_geojson: null },
    ]);
    expect(r).toEqual([{ id: "e1", via: "CAR" }, { id: "e2", via: "GEOMETRIA" }, { id: "e3", via: "GEOMETRIA" }]);
  });
});

describe("regras – sugestão de situação", () => {
  const doc = (p: Partial<DocumentoCruzado>): DocumentoCruzado => ({ id: "d", numero: "ASV-001/2026", tipo: "AUTORIZACAO", sigla_ato: "ASV", emitido_em: "2026-01-10T12:00:00Z", validade_ate: "2027-01-10T00:00:00Z", status: "VALIDO", ...p });
  const car = (n: number): Cruzamento["car"] => ({ status: "OK", imoveis: Array.from({ length: n }, (_, i) => ({ cod_imovel: `BA-${i}`, area_imovel_ha: 10, sobreposicao_ha: 1, percentual_alerta: 50, situacao: "Ativo", condicao: null, tipo: "Imóvel rural", municipio: "X" })) });
  const emp = (docs: DocumentoCruzado[]) => [{ id: "e", nome: "Fazenda X", numero_car: "BA-0", via: "CAR" as const, processos: [], documentos: docs }];

  it("ASV válida emitida antes da detecção → AUTORIZADO", () => {
    const s = sugerirStatus({ car: car(1), empreendimentos: emp([doc({})]) }, "2026-03-01");
    expect(s.sugestao).toBe("AUTORIZADO");
    expect(s.documento?.sigla_ato).toBe("ASV");
    expect(s.motivo).toContain("ASV-001/2026");
  });

  it("autorização emitida DEPOIS da detecção, vencida, cancelada ou de sigla não autorizadora → não autoriza", () => {
    for (const d of [doc({ emitido_em: "2026-04-01T00:00:00Z" }), doc({ validade_ate: "2026-02-01T00:00:00Z" }), doc({ status: "CANCELADO" }), doc({ tipo: "LICENCA", sigla_ato: "LP" })]) {
      expect(sugerirStatus({ car: car(1), empreendimentos: emp([d]) }, "2026-03-01").sugestao).toBe("POSSIVEL_IRREGULAR");
    }
  });

  it("ASV tem prioridade sobre licença", () => {
    const d = documentoQueAutoriza([doc({ id: "li", tipo: "LICENCA", sigla_ato: "LI", emitido_em: "2026-02-01T00:00:00Z" }), doc({ id: "asv" })], "2026-03-01");
    expect(d?.id).toBe("asv");
  });

  it("imóvel do CAR sem autorização → POSSÍVEL IRREGULAR; sem CAR → SEM_CAR; CAR fora do ar → INDETERMINADO", () => {
    expect(sugerirStatus({ car: car(2), empreendimentos: [] }, "2026-03-01").sugestao).toBe("POSSIVEL_IRREGULAR");
    expect(sugerirStatus({ car: car(0), empreendimentos: [] }, "2026-03-01").sugestao).toBe("SEM_CAR");
    expect(sugerirStatus({ car: { status: "ERRO", erro: "HTTP 503", imoveis: [] }, empreendimentos: [] }, "2026-03-01").sugestao).toBe("INDETERMINADO");
    expect(sugerirStatus({ car: { status: "ERRO", imoveis: [] }, empreendimentos: emp([]) }, "2026-03-01").sugestao).toBe("POSSIVEL_IRREGULAR");
  });

  it("transições, aviso por área mínima e indicadores", () => {
    expect(podeTransicionarAlerta("NOVO", "DESCARTADO")).toBe(true);
    expect(podeTransicionarAlerta("DESCARTADO", "AUTORIZADO")).toBe(false);
    expect(podeTransicionarAlerta("DESCARTADO", "EM_ANALISE")).toBe(true);
    expect(deveNotificar({ status: "NOVO", area_ha: 1.2 }, 1)).toBe(true);
    expect(deveNotificar({ status: "NOVO", area_ha: 0.5 }, 1)).toBe(false);
    expect(deveNotificar({ status: "EM_ANALISE", area_ha: 50 }, 1)).toBe(false);
    const k = indicadores([
      { area_ha: 10, status: "NOVO", status_sugerido: "POSSIVEL_IRREGULAR", com_car: true },
      { area_ha: 5, status: "NOVO", status_sugerido: "AUTORIZADO", com_car: true },
      { area_ha: 2.5, status: "DESCARTADO", status_sugerido: "SEM_CAR", com_car: false },
      { area_ha: 2.5, status: "AUTORIZADO", status_sugerido: "POSSIVEL_IRREGULAR", com_car: false },
    ]);
    expect(k).toEqual({ total: 4, area_ha: 20, novos: 2, pct_com_car: 50, pct_sem_autorizacao: 33.3 });
    expect(indicadores([]).pct_com_car).toBeNull();
  });
});

describe("geometria – simplificação robusta", () => {
  it("MultiPolygon com partes minúsculas não quebra a simplificação agressiva (partes colapsadas são descartadas)", () => {
    const grande: [number, number][] = Array.from({ length: 3000 }, (_, i) => {
      const t = (i / 3000) * Math.PI * 2;
      return [-45 + Math.cos(t) * 0.05 + Math.sin(t * 41) * 0.0004, -12 + Math.sin(t) * 0.05];
    });
    grande.push(grande[0]);
    const minusculas = Array.from({ length: 50 }, (_, i) => (quadrado(-44.9 + i * 0.001, -11.9, 0.00001) as { coordinates: [number, number][][] }).coordinates);
    const g: PoligonoGeo = { type: "MultiPolygon", coordinates: [[grande], ...minusculas] };
    const s = simplificarGeometria(g, 6_000);
    expect(s).not.toBeNull();
    expect(JSON.stringify(s).length).toBeLessThanOrEqual(6_000);
    expect(areaHa(s!) / areaHa({ type: "Polygon", coordinates: [grande] })).toBeCloseTo(1, 1);
  });
});
