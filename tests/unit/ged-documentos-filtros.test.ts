import { describe, expect, it } from "vitest";
import { dataValida, filtrosParaQuery, intersectar, lerFiltros, montarWhereFiltros, ordenarPorRank, orderByDe, paginar, temFiltro } from "@/lib/ged/documentos/filtros";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("lerFiltros", () => {
  it("padrões: atualizado desc, página 1, 20 por página, sem filtros", () => {
    const f = lerFiltros({});
    expect(f).toMatchObject({ ordem: "atualizado", dir: "desc", page: 1, size: 20, q: "", marcadores: [], arquivados: false, pessoais: false });
    expect(temFiltro(f)).toBe(false);
  });
  it("com q a ordem padrão é relevância; relevância sem q cai para atualizado", () => {
    expect(lerFiltros({ q: "água" }).ordem).toBe("relevancia");
    expect(lerFiltros({ ordem: "relevancia:desc" }).ordem).toBe("atualizado");
  });
  it("saneia valores inválidos (nunca lança)", () => {
    const f = lerFiltros({ status: "XYZ", sens: "foo", de: "2026-13-40", ate: "abc", tipo: "não-uuid", pasta: "'; drop", page: "-4", size: "9999", ordem: "senha:asc", marcador: ["x", U1, U1, U2] });
    expect(f).toMatchObject({ status: null, sens: null, de: null, ate: null, tipo: null, pasta: null, page: 1, size: 20, ordem: "atualizado" });
    expect(f.marcadores).toEqual([U1, U2]);
  });
  it("aceita pasta 'sem', datas válidas e direção explícita", () => {
    const f = lerFiltros({ pasta: "sem", de: "2026-02-28", ate: "2026-03-01", ordem: "titulo:desc", size: "50", page: "3" });
    expect(f).toMatchObject({ pasta: "sem", de: "2026-02-28", ate: "2026-03-01", ordem: "titulo", dir: "desc", size: 50, page: 3 });
  });
  it("título/numero ordenam asc por padrão; limita tamanho de texto", () => {
    expect(lerFiltros({ ordem: "titulo" }).dir).toBe("asc");
    expect(lerFiltros({ q: "a".repeat(500) }).q).toHaveLength(200);
  });
  it("funciona com URLSearchParams e valores repetidos", () => {
    const f = lerFiltros(new URLSearchParams(`marcador=${U1}&marcador=${U2}&pessoais=1&arquivados=1`));
    expect(f.marcadores).toHaveLength(2);
    expect(f.pessoais && f.arquivados).toBe(true);
  });
  it("dataValida rejeita datas inexistentes", () => {
    expect(dataValida("2026-02-30")).toBe(false);
    expect(dataValida("2026-02-28")).toBe(true);
    expect(dataValida(null)).toBe(false);
  });
});

describe("filtrosParaQuery", () => {
  it("omite padrões e faz ida e volta", () => {
    expect(filtrosParaQuery(lerFiltros({}))).toBe("");
    const f = lerFiltros({ q: "água", titulo: "edital", marcador: [U1], status: "PUBLICADO", ordem: "data:asc", page: "2", size: "50" });
    const g = lerFiltros(new URLSearchParams(filtrosParaQuery(f).slice(1)));
    expect(g).toEqual(f);
  });
  it("mudar sobrepõe campos (paginação)", () => {
    const f = lerFiltros({ titulo: "x" });
    expect(filtrosParaQuery(f, { page: 2 })).toBe("?titulo=x&page=2");
  });
});

describe("montarWhereFiltros", () => {
  const and = (w: ReturnType<typeof montarWhereFiltros>) => (w.AND as object[]);
  it("por padrão exclui arquivados e excluídos", () => {
    const a = and(montarWhereFiltros(lerFiltros({})));
    expect(a).toContainEqual({ excluido_em: null });
    expect(a).toContainEqual({ status: { not: "ARQUIVADO" } });
  });
  it("status explícito (inclusive ARQUIVADO) e arquivados=1", () => {
    expect(and(montarWhereFiltros(lerFiltros({ status: "ARQUIVADO" })))).toContainEqual({ status: "ARQUIVADO" });
    expect(and(montarWhereFiltros(lerFiltros({ arquivados: "1" })))).not.toContainEqual({ status: { not: "ARQUIVADO" } });
  });
  it("pasta inclui subpastas via caminho_ids; 'sem' = sem pasta", () => {
    expect(and(montarWhereFiltros(lerFiltros({ pasta: U1 })))).toContainEqual({ pasta: { is: { caminho_ids: { has: U1 } } } });
    expect(and(montarWhereFiltros(lerFiltros({ pasta: "sem" })))).toContainEqual({ pasta_id: null });
  });
  it("marcadores: exige todos; intervalo de data; sensibilidade; dados pessoais", () => {
    const a = and(montarWhereFiltros(lerFiltros({ marcador: [U1, U2], de: "2026-01-01", ate: "2026-01-31", sens: "SIGILOSO", pessoais: "1" })));
    expect(a).toContainEqual({ marcadores: { some: { marcador_id: U1 } } });
    expect(a).toContainEqual({ marcadores: { some: { marcador_id: U2 } } });
    expect(a).toContainEqual({ data_documento: { gte: new Date("2026-01-01T00:00:00Z"), lte: new Date("2026-01-31T00:00:00Z") } });
    expect(a).toContainEqual({ sensibilidade: "SIGILOSO" });
    expect(a).toContainEqual({ contem_dados_pessoais: true });
  });
  it("ids: lista vazia não casa nada; null não restringe", () => {
    expect(and(montarWhereFiltros(lerFiltros({}), []))).toContainEqual({ id: { in: [] } });
    expect(and(montarWhereFiltros(lerFiltros({}), null)).some((c) => "id" in c)).toBe(false);
  });
  it("NÃO contém nenhuma regra de visibilidade (isso é do whereGedVisivel)", () => {
    expect(JSON.stringify(montarWhereFiltros(lerFiltros({})))).not.toMatch(/acls|criado_por_id|solicitacoes/);
  });
});

describe("ordenação e paginação", () => {
  it("orderBy com desempate estável", () => {
    expect(orderByDe({ ordem: "titulo", dir: "asc" })).toEqual([{ titulo: "asc" }, { id: "asc" }]);
    expect(orderByDe({ ordem: "data", dir: "desc" })[0]).toEqual({ data_documento: { sort: "desc", nulls: "last" } });
  });
  it("ordenarPorRank: maior rank primeiro, empate mantém a ordem", () => {
    const r = new Map([["a", 0.1], ["b", 0.9], ["c", 0.9], ["d", 0.5]]);
    expect(ordenarPorRank(["a", "b", "c", "d"], r)).toEqual(["b", "c", "d", "a"]);
    expect(ordenarPorRank(["a", "b", "c", "d"], r, "asc")).toEqual(["a", "d", "b", "c"]);
  });
  it("intersectar ignora null e cruza listas", () => {
    expect(intersectar([null, null])).toBeNull();
    expect(intersectar([["a", "b", "c"], null, ["b", "c", "d"]])).toEqual(["b", "c"]);
    expect(intersectar([["a"], []])).toEqual([]);
  });
  it("paginar", () => {
    const l = [1, 2, 3, 4, 5];
    expect(paginar(l, 2, 2)).toEqual([3, 4]);
    expect(paginar(l, 3, 2)).toEqual([5]);
    expect(paginar(l, 9, 2)).toEqual([]);
  });
});
