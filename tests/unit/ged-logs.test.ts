import { describe, expect, it } from "vitest";
import { BOM_UTF8, celulaCsv, linhaCsv, montarCsv } from "@/lib/ged/logs/csv";
import {
  ACOES_ACESSO, condicaoDocumentoAuditoria, documentoEhId, intervaloPeriodo, lerFiltros, paramsDosFiltros, TAMANHO_PAGINA_LOGS, whereAcessos, whereAlteracoes, whereComunicacoes,
} from "@/lib/ged/logs/filtros";
import { dataCorteRetencao, RETENCAO_MINIMA_DIAS } from "@/lib/ged/logs/retencao";
import { resumirJson, textoResumo } from "@/lib/ged/logs/resumo-json";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U = "11111111-1111-4111-8111-111111111111";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("lerFiltros", () => {
  it("padrões e valores inválidos viram nulos", () => {
    const f = lerFiltros({ aba: "x", de: "2026-13-40", ate: "lixo", usuario: "nao-uuid", canal: "SMS", status: "?", page: "-3" });
    expect(f).toMatchObject({ aba: "acessos", de: null, ate: null, usuario_id: null, canal: null, status: null, page: 1 });
  });
  it("aceita valores válidos (e o primeiro de um array)", () => {
    const f = lerFiltros({ aba: "comunicacoes", de: "2026-10-01", ate: "2026-10-07", usuario: U, canal: "WHATSAPP", status: ["ERRO", "ENVIADA"], page: "3", documento: " DOC-2026 " });
    expect(f).toMatchObject({ aba: "comunicacoes", de: "2026-10-01", ate: "2026-10-07", usuario_id: U, canal: "WHATSAPP", status: "ERRO", page: 3, documento: "DOC-2026" });
  });
  it("página absurda é limitada; data inexistente (30/02) é rejeitada", () => {
    expect(lerFiltros({ page: "99999999" }).page).toBe(100000);
    expect(lerFiltros({ de: "2026-02-30" }).de).toBeNull();
  });
  it("reconhece id de documento", () => {
    expect(documentoEhId({ documento: D })).toBe(true);
    expect(documentoEhId({ documento: "DOC-1" })).toBe(false);
    expect(documentoEhId({ documento: null })).toBe(false);
  });
});

describe("período (Brasília UTC−3)", () => {
  it("[de 00:00, ate+1 00:00)", () => {
    const p = intervaloPeriodo({ de: "2026-10-01", ate: "2026-10-07" });
    expect(p.gte?.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(p.lt?.toISOString()).toBe("2026-10-08T03:00:00.000Z");
  });
  it("sem datas: sem limites", () => expect(intervaloPeriodo({ de: null, ate: null })).toEqual({}));
});

describe("where das consultas", () => {
  const base = lerFiltros({});
  it("alterações: SEMPRE com organizacao_id e entidades ged*", () => {
    const w = whereAlteracoes(ORG, base, null);
    expect(JSON.stringify(w)).toContain(ORG);
    expect(JSON.stringify(w)).toContain('"startsWith":"ged"');
    const com = whereAlteracoes(ORG, lerFiltros({ usuario: U, acao: "ACL; DROP", de: "2026-10-01" }), { ids: [D] });
    const s = JSON.stringify(com);
    expect(s).toContain(ORG);
    expect(s).toContain(U);
    expect(s).toContain("ACLDROP"); // acao é saneada (só \w)
    expect(s).toContain(D);
  });
  it("alterações de documento sem número encontrado não casa com nada", () => {
    expect(JSON.stringify(whereAlteracoes(ORG, base, { ids: [] }))).toContain('"id":{"in":[]}');
  });
  it("acessos: ação só da lista permitida; documento por ids", () => {
    expect(whereAcessos(lerFiltros({ acao: "NEGADO" }), null)).toEqual({ acao: "NEGADO" });
    expect(whereAcessos(lerFiltros({ acao: "HACK" }), null)).toEqual({});
    expect(ACOES_ACESSO).toContain("LOGIN_GED");
    expect(whereAcessos(base, { ids: [D] })).toEqual({ documento_id: { in: [D] } });
  });
  it("comunicações: canal, status, evento, usuário e período", () => {
    const w = whereComunicacoes(lerFiltros({ canal: "EMAIL", status: "ERRO", evento: "TRAMITE_RECEBIDO", usuario: U, de: "2026-10-01" }), null);
    expect(w).toMatchObject({ canal: "EMAIL", status: "ERRO", evento: "TRAMITE_RECEBIDO", usuario_id: U });
    expect(w.created_at).toBeDefined();
  });
  it("condição de documento na auditoria olha entidade_id e documento_id no antes/depois", () => {
    const c = JSON.stringify(condicaoDocumentoAuditoria([D]));
    expect(c).toContain("entidade_id");
    expect(c).toContain("documento_id");
  });
  it("querystring preserva filtros e troca a página", () => {
    const f = lerFiltros({ aba: "comunicacoes", canal: "EMAIL", de: "2026-10-01" });
    const q = new URLSearchParams(paramsDosFiltros(f, { page: 2, formato: "csv" }));
    expect(q.get("aba")).toBe("comunicacoes");
    expect(q.get("canal")).toBe("EMAIL");
    expect(q.get("page")).toBe("2");
    expect(q.get("formato")).toBe("csv");
    expect(TAMANHO_PAGINA_LOGS).toBeGreaterThan(0);
  });
});

describe("CSV", () => {
  it("escapa aspas, separador e quebra de linha", () => {
    expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""');
    expect(celulaCsv("a;b")).toBe('"a;b"');
    expect(celulaCsv("a\nb")).toBe('"a\nb"');
    expect(celulaCsv(null)).toBe("");
    expect(celulaCsv(42)).toBe("42");
  });
  it("neutraliza injeção de fórmula", () => {
    for (const v of ["=1+1", "+SOMA(A1)", "-2", "@cmd", "\tx"]) expect(celulaCsv(v).replace(/"/g, "").startsWith("'")).toBe(true);
    expect(celulaCsv("normal")).toBe("normal");
  });
  it("linha termina em CRLF; montarCsv inclui BOM e cabeçalho", () => {
    expect(linhaCsv(["a", "b"])).toBe("a;b\r\n");
    const c = montarCsv(["X", "Y"], [["1", "2"], ["3", "4"]]);
    expect(c.startsWith(BOM_UTF8 + "X;Y\r\n")).toBe(true);
    expect(c.trim().split("\r\n")).toHaveLength(3);
  });
});

describe("resumo seguro de antes/depois", () => {
  it("oculta segredos e dados pessoais", () => {
    const r = resumirJson({ nome: "Setor X", papel: "GED_ADMIN", senha_hash: "abc", api_key: "k", token: "t", email: "a@b.c", cpf: "1", telefone: "2" });
    const m = Object.fromEntries(r.map((c) => [c.campo, c.valor]));
    expect(m.nome).toBe("Setor X");
    expect(m.papel).toBe("GED_ADMIN");
    for (const k of ["senha_hash", "api_key", "token", "email", "cpf", "telefone"]) expect(m[k]).toBe("[oculto]");
  });
  it("limita campos e tamanho; aceita nulo e não-objeto", () => {
    const grande = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, "x".repeat(300)]));
    const r = resumirJson(grande);
    expect(r).toHaveLength(9);
    expect(r[0].valor.length).toBeLessThanOrEqual(101);
    expect(resumirJson(null)).toEqual([]);
    expect(resumirJson("texto")).toEqual([{ campo: "valor", valor: "texto" }]);
    expect(textoResumo({ a: 1, b: null })).toBe("a: 1; b: —");
  });
});

describe("retenção", () => {
  it("corte = agora − dias, com mínimo de 90", () => {
    const agora = new Date("2026-10-07T00:00:00Z");
    expect(dataCorteRetencao(730, agora).toISOString()).toBe("2024-10-07T00:00:00.000Z");
    expect(dataCorteRetencao(1, agora).getTime()).toBe(agora.getTime() - RETENCAO_MINIMA_DIAS * 86_400_000);
  });
});
