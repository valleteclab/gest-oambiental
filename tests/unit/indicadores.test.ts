import { describe, expect, it } from "vitest";
import {
  META_ADESAO,
  ORDEM_STATUS,
  STATUS_EM_ANDAMENTO,
  aderiu,
  dataFiltro,
  diasEntre,
  isoDia,
  mediaDias,
  percentual,
  periodoPadrao,
  resumoAdesao,
  somarLinhas,
  tempoMedio,
} from "@/lib/indicadores/agregacao";
import { lerFiltros, queryFiltros } from "@/lib/indicadores/filtros";
import { agruparSigla, corSigla, COR_OUTROS, SERIES } from "@/components/graficos/paleta";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("tempo médio de tramitação", () => {
  it("calcula a média de dias protocolo → conclusão", () => {
    expect(tempoMedio([{ inicio: d("2026-01-01"), fim: d("2026-01-11") }, { inicio: d("2026-02-01"), fim: d("2026-03-03") }])).toBe(20);
  });
  it("ignora pares incompletos e retorna null sem dados", () => {
    expect(tempoMedio([{ inicio: null, fim: d("2026-01-01") }, { inicio: d("2026-01-01"), fim: null }])).toBeNull();
    expect(tempoMedio([])).toBeNull();
  });
  it("arredonda para 1 casa e trata soma/quantidade", () => {
    expect(mediaDias(10, 3)).toBe(3.3);
    expect(mediaDias(0, 0)).toBeNull();
    expect(diasEntre(d("2026-01-01"), d("2026-01-02"))).toBe(1);
  });
  it("média ponderada = soma total / quantidade total (não média de médias)", () => {
    // município A: 1 processo com 10 dias; B: 3 processos com 30 dias cada → 25, não 20
    expect(mediaDias(10 + 90, 1 + 3)).toBe(25);
  });
});

describe("adesão dos municípios", () => {
  it("município aderido exige ≥1 usuário ativo e ≥1 processo", () => {
    expect(aderiu({ usuarios_ativos: 1, processos_total: 1 })).toBe(true);
    expect(aderiu({ usuarios_ativos: 0, processos_total: 5 })).toBe(false);
    expect(aderiu({ usuarios_ativos: 3, processos_total: 0 })).toBe(false);
  });
  it("percentual e meta de 60%", () => {
    const linhas = [
      { usuarios_ativos: 2, processos_total: 4 },
      { usuarios_ativos: 1, processos_total: 1 },
      { usuarios_ativos: 1, processos_total: 0 },
      { usuarios_ativos: 0, processos_total: 0 },
      { usuarios_ativos: 5, processos_total: 9 },
    ];
    const r = resumoAdesao(linhas);
    expect(r).toMatchObject({ aderidos: 3, total: 5, percentual: 60, meta: META_ADESAO, atingiu: true });
    expect(resumoAdesao(linhas.slice(2)).atingiu).toBe(false);
    expect(resumoAdesao([]).atingiu).toBe(false);
  });
  it("percentual com 1 casa e total zero", () => {
    expect(percentual(3, 8)).toBe(37.5);
    expect(percentual(1, 3)).toBe(33.3);
    expect(percentual(1, 0)).toBe(0);
  });
});

describe("totais e status", () => {
  it("somarLinhas soma campo a campo", () => {
    expect(somarLinhas([{ a: 1, b: 2.5 }, { a: 3, b: 1 }], ["a", "b"])).toEqual({ a: 4, b: 3.5 });
  });
  it("ordem de status cobre todos exceto RASCUNHO e em andamento ⊂ ordem", () => {
    expect(ORDEM_STATUS).not.toContain("RASCUNHO");
    expect(ORDEM_STATUS).toHaveLength(10);
    for (const s of STATUS_EM_ANDAMENTO) expect(ORDEM_STATUS).toContain(s);
    expect(STATUS_EM_ANDAMENTO).not.toContain("CONCLUIDO");
  });
});

describe("filtros de período", () => {
  it("interpreta datas no fuso da Bahia (UTC-3)", () => {
    expect(dataFiltro("2026-03-10")!.toISOString()).toBe("2026-03-10T03:00:00.000Z");
    expect(dataFiltro("2026-03-10", true)!.toISOString()).toBe("2026-03-11T02:59:59.999Z");
    expect(dataFiltro("10/03/2026")).toBeNull();
    expect(dataFiltro(null)).toBeNull();
  });
  it("período padrão: 1º de janeiro até hoje", () => {
    expect(periodoPadrao(new Date("2026-09-27T15:00:00Z"))).toEqual({ de: "2026-01-01", ate: "2026-09-27" });
    expect(isoDia(new Date("2026-01-01T02:00:00Z"))).toBe("2025-12-31");
  });
  it("lerFiltros descarta valores inválidos e inverte período trocado", () => {
    const f = lerFiltros(new URLSearchParams("municipio=xyz&de=2026-05-01&ate=2026-01-01&tipo_ato=&tecnico=00000000-0000-4000-8000-000000000001"));
    expect(f).toEqual({ municipio_id: null, de: "2026-01-01", ate: "2026-05-01", tipo_ato_id: null, tecnico_id: "00000000-0000-4000-8000-000000000001" });
    expect(queryFiltros(f, { formato: "pdf" })).toBe("?de=2026-01-01&ate=2026-05-01&tecnico=00000000-0000-4000-8000-000000000001&formato=pdf");
    expect(queryFiltros({})).toBe("");
  });
});

describe("paleta dos gráficos", () => {
  it("cor fixa por sigla (segue a entidade) e excedentes em Outros", () => {
    expect(corSigla("LO")).toBe(SERIES[0]);
    expect(corSigla("LI")).toBe(SERIES[1]);
    expect(corSigla("DECL")).toBe(COR_OUTROS);
    expect(agruparSigla("RLO")).toBe("Outros");
    expect(agruparSigla("LP")).toBe("LP");
  });
});
