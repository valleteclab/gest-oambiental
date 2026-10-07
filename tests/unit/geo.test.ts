import { describe, expect, it } from "vitest";
import { codigoIbgeReal, normalizarUf, ufDoMunicipio, ufPorCodigoIbge, UF_POR_CODIGO_IBGE } from "@/lib/geo/uf";
import { CAMADAS, camadasBase, camadasSobreposicao, resolverModelo, ID_BASE_PADRAO, WAYBACK_RELEASES, urlWayback } from "@/lib/geo/camadas";
import { areaM2, extrairPoligono, m2ParaHa, PoligonoGeoJsonSchema, TAMANHO_MAX_POLIGONO, validarPoligono } from "@/lib/geo/validar";

// ~1 ha no oeste baiano (100 m × 100 m aproximadamente)
const QUADRADO = { type: "Polygon", coordinates: [[[-44.91, -11.75], [-44.90908, -11.75], [-44.90908, -11.75090], [-44.91, -11.75090], [-44.91, -11.75]]] };

describe("lib/geo/uf", () => {
  it("mapeia os 27 estados pelo prefixo IBGE", () => {
    expect(Object.keys(UF_POR_CODIGO_IBGE)).toHaveLength(27);
    expect(ufPorCodigoIbge("2903201")).toBe("BA");
    expect(ufPorCodigoIbge("29")).toBe("BA");
    expect(ufPorCodigoIbge(3550308)).toBe("SP");
    expect(ufPorCodigoIbge("5300108")).toBe("DF");
    expect(ufPorCodigoIbge("1100015")).toBe("RO");
  });
  it("códigos fictícios/ inválidos → null, e UF padrão para os mapas", () => {
    expect(ufPorCodigoIbge("9900101")).toBeNull();
    expect(ufPorCodigoIbge("29a")).toBeNull();
    expect(ufPorCodigoIbge(null)).toBeNull();
    expect(codigoIbgeReal("9900101")).toBe(false);
    expect(codigoIbgeReal("2903201")).toBe(true);
    expect(ufDoMunicipio("9900101")).toBe("BA");
    expect(ufDoMunicipio("9900101", "go")).toBe("GO");
    expect(ufDoMunicipio("3106200", "BA")).toBe("MG");
    expect(ufDoMunicipio("9900101", "XX")).toBeNull();
    expect(normalizarUf(" ba ")).toBe("BA");
  });
});

describe("lib/geo/camadas (catálogo)", () => {
  it("ids únicos e campos obrigatórios coerentes com o tipo", () => {
    const ids = CAMADAS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAMADAS) {
      expect(c.nome.length).toBeGreaterThan(3);
      expect(c.attribution.length).toBeGreaterThan(3);
      expect(c.fonte.length).toBeGreaterThan(2);
      if (c.tipo === "wms") {
        expect(c.url).toMatch(/^https:\/\//);
        expect(c.layers).toBeTruthy();
      }
      if (c.tipo === "xyz") expect(c.url).toMatch(/^https:\/\/.*\{z\}.*\{[xy]\}/);
      if (c.tipo === "google") expect(c.googleTipo).toBeTruthy();
      if (c.porUf) expect(`${c.url}${c.layers}`).toContain("{uf}");
      if (!c.teste.ok) expect(c.instavel).toBe(true);
    }
  });
  it("base padrão é o satélite Esri; Google só com chave e nunca no mapa público", () => {
    expect(ID_BASE_PADRAO).toBe("esri-satelite");
    expect(camadasBase({ google: false }).map((c) => c.id)).toEqual(["esri-satelite", "osm"]);
    expect(camadasBase({ google: true }).map((c) => c.id)).toEqual(["esri-satelite", "osm", "google-satelite", "google-hibrido", "google-ruas"]);
    expect(camadasBase({ google: true, publico: true }).map((c) => c.id)).toEqual(["esri-satelite", "osm"]);
  });
  it("sobreposições: por UF só com UF, limite municipal só com código IBGE real, nenhuma no público", () => {
    const semUf = camadasSobreposicao({ uf: null }).map((c) => c.id);
    expect(semUf).not.toContain("car");
    expect(semUf).not.toContain("limite-municipio");
    expect(semUf).toContain("prodes-cerrado");
    const comUf = camadasSobreposicao({ uf: "BA", codigoIbge: "2903201" }).map((c) => c.id);
    expect(comUf).toEqual(expect.arrayContaining(["car", "sigef", "limite-municipio", "ibge-municipios"]));
    expect(camadasSobreposicao({ uf: "BA", publico: true })).toEqual([]);
  });
  it("resolve {uf}/{UF}/{codigo_ibge}", () => {
    const car = CAMADAS.find((c) => c.id === "car")!;
    expect(resolverModelo(car.layers!, { uf: "BA" })).toBe("sicar:sicar_imoveis_ba");
    expect(resolverModelo("x/{UF}/{codigo_ibge}", { uf: "ba", codigoIbge: "2903201" })).toBe("x/BA/2903201");
  });
  it("Wayback: releases ordenados do mais recente ao mais antigo", () => {
    const datas = WAYBACK_RELEASES.map((w) => w.data);
    expect([...datas].sort().reverse()).toEqual(datas);
    expect(urlWayback(10)).toContain("/tile/10/{z}/{y}/{x}");
  });
});

describe("lib/geo/validar", () => {
  it("aceita Polygon válido e calcula a área (~1 ha)", () => {
    const r = validarPoligono(QUADRADO);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(m2ParaHa(r.areaM2)).toBeGreaterThan(0.95);
      expect(m2ParaHa(r.areaM2)).toBeLessThan(1.05);
    }
  });
  it("aceita string JSON, Feature e FeatureCollection (→ geometria), descartando altitude", () => {
    expect(validarPoligono(JSON.stringify(QUADRADO)).ok).toBe(true);
    const f = validarPoligono({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [QUADRADO.coordinates[0].map(([x, y]) => [x, y, 450])] } });
    expect(f.ok && f.geometria).toEqual(expect.objectContaining({ type: "Polygon" }));
    if (f.ok) expect(f.geometria.coordinates[0][0]).toHaveLength(2);
    const fc = validarPoligono({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: QUADRADO }, { type: "Feature", properties: {}, geometry: QUADRADO }] });
    expect(fc.ok && fc.geometria.type).toBe("MultiPolygon");
  });
  it("rejeita anel aberto, poucas posições, coordenadas fora do intervalo, outros tipos e excesso de tamanho", () => {
    const aberto = { type: "Polygon", coordinates: [[[-44.91, -11.75], [-44.9, -11.75], [-44.9, -11.76], [-44.91, -11.76]]] };
    expect(validarPoligono(aberto)).toEqual({ ok: false, erro: expect.stringMatching(/fechado/) });
    expect(validarPoligono({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [0, 0]]] }).ok).toBe(false);
    expect(validarPoligono({ type: "Polygon", coordinates: [[[-200, 0], [1, 1], [1, 0], [-200, 0]]] })).toEqual({ ok: false, erro: expect.stringMatching(/intervalo/) });
    expect(validarPoligono({ type: "Polygon", coordinates: [[[0, 95], [1, 1], [1, 0], [0, 95]]] }).ok).toBe(false);
    expect(validarPoligono({ type: "Point", coordinates: [0, 0] }).ok).toBe(false);
    expect(validarPoligono({ type: "Polygon", coordinates: [] }).ok).toBe(false);
    expect(validarPoligono("{x").ok).toBe(false);
    const n = 20_000;
    const anel = Array.from({ length: n }, (_, i) => [-44.9 + 0.01 * Math.cos((2 * Math.PI * i) / n) + 1e-7 * i, -11.7 + 0.01 * Math.sin((2 * Math.PI * i) / n)]);
    anel.push(anel[0]);
    const grande = validarPoligono({ type: "Polygon", coordinates: [anel] });
    expect(JSON.stringify({ type: "Polygon", coordinates: [anel] }).length).toBeGreaterThan(TAMANHO_MAX_POLIGONO);
    expect(grande).toEqual({ ok: false, erro: expect.stringMatching(/300 KB/) });
  });
  it("extrairPoligono ignora pontos/linhas e devolve null sem polígonos", () => {
    expect(extrairPoligono({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }] })).toBeNull();
  });
  it("schema zod: vazio → null; inválido → erro com prefixo Polígono", () => {
    expect(PoligonoGeoJsonSchema.parse("")).toBeNull();
    expect(PoligonoGeoJsonSchema.parse(undefined)).toBeNull();
    const r = PoligonoGeoJsonSchema.safeParse('{"type":"LineString","coordinates":[[0,0],[1,1]]}');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/^Polígono:/);
    expect(areaM2(QUADRADO as GeoJSON.Polygon)).toBeGreaterThan(9000);
  });
});
