import { describe, expect, it } from "vitest";
import { injetarEscopo, NaoEncontradoGed, naoEncontrado, TenantDivergenteGed } from "@/lib/ged/db";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("injetarEscopo – leituras com where livre", () => {
  for (const op of ["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]) {
    it(`${op}: sem where vira { organizacao_id }`, () => {
      expect(injetarEscopo(op, {}, A).where).toEqual({ organizacao_id: A });
      expect(injetarEscopo(op, undefined, A).where).toEqual({ organizacao_id: A });
    });
    it(`${op}: preserva o where com AND`, () => {
      expect(injetarEscopo(op, { where: { titulo: "x" } }, A).where).toEqual({ AND: [{ titulo: "x" }, { organizacao_id: A }] });
    });
  }

  it("OR do chamador não escapa: o escopo fica fora do OR", () => {
    const r = injetarEscopo("findMany", { where: { OR: [{ id: "1" }, { organizacao_id: B }] } }, A);
    expect(r.where).toEqual({ AND: [{ OR: [{ id: "1" }, { organizacao_id: B }] }, { organizacao_id: A }] });
  });

  it("where com AND/NOT aninhados continua escopado", () => {
    const r = injetarEscopo("count", { where: { AND: [{ status: "ASSINADO" }], NOT: { id: "z" } } }, A);
    expect((r.where as { AND: unknown[] }).AND.at(-1)).toEqual({ organizacao_id: A });
  });

  it("não altera o objeto recebido e mantém os demais args", () => {
    const args = { where: { a: 1 }, take: 5, orderBy: { created_at: "desc" } };
    const r = injetarEscopo("findMany", args, A);
    expect(args).toEqual({ where: { a: 1 }, take: 5, orderBy: { created_at: "desc" } });
    expect(r.take).toBe(5);
    expect(r.orderBy).toEqual({ created_at: "desc" });
  });

  it("updateMany exige que data não troque o tenant", () => {
    expect(() => injetarEscopo("updateMany", { where: {}, data: { organizacao_id: B } }, A)).toThrow(TenantDivergenteGed);
    expect(() => injetarEscopo("updateMany", { where: {}, data: { organizacao_id: { set: B } } }, A)).toThrow(TenantDivergenteGed);
    expect(() => injetarEscopo("updateMany", { where: {}, data: { organizacao_id: A, titulo: "x" } }, A)).not.toThrow();
  });
});

describe("injetarEscopo – where único", () => {
  for (const op of ["findUnique", "findUniqueOrThrow", "update", "delete"]) {
    it(`${op}: acrescenta organizacao_id ao where único`, () => {
      expect(injetarEscopo(op, { where: { id: "1" }, data: {} }, A).where).toEqual({ id: "1", organizacao_id: A });
    });
    it(`${op}: where com organizacao_id de outro cliente é erro`, () => {
      expect(() => injetarEscopo(op, { where: { id: "1", organizacao_id: B } }, A)).toThrow(TenantDivergenteGed);
    });
    it(`${op}: sem where é erro`, () => {
      expect(() => injetarEscopo(op, {}, A)).toThrow();
    });
  }

  it("unique composto com org divergente continua escopado (não encontra)", () => {
    const r = injetarEscopo("findUnique", { where: { organizacao_id_numero: { organizacao_id: B, numero: "X" } } }, A);
    expect(r.where).toEqual({ organizacao_id_numero: { organizacao_id: B, numero: "X" }, organizacao_id: A });
  });

  it("update não pode trocar o tenant", () => {
    expect(() => injetarEscopo("update", { where: { id: "1" }, data: { organizacao_id: B } }, A)).toThrow(TenantDivergenteGed);
  });
});

describe("injetarEscopo – upsert", () => {
  it("escopa where único e o create; update não pode trocar o tenant", () => {
    const r = injetarEscopo("upsert", { where: { id: "1" }, create: { nome: "n" }, update: { nome: "m" } }, A);
    expect(r.where).toEqual({ id: "1", organizacao_id: A });
    expect(r.create).toEqual({ nome: "n", organizacao_id: A });
    expect(r.update).toEqual({ nome: "m" });
    expect(() => injetarEscopo("upsert", { where: { id: "1" }, create: { organizacao_id: B }, update: {} }, A)).toThrow(TenantDivergenteGed);
    expect(() => injetarEscopo("upsert", { where: { id: "1" }, create: {}, update: { organizacao_id: B } }, A)).toThrow(TenantDivergenteGed);
  });
});

describe("injetarEscopo – criação", () => {
  it("create injeta organizacao_id", () => {
    expect(injetarEscopo("create", { data: { nome: "x" } }, A).data).toEqual({ nome: "x", organizacao_id: A });
  });
  it("create com o mesmo organizacao_id é aceito", () => {
    expect(injetarEscopo("create", { data: { nome: "x", organizacao_id: A } }, A).data).toEqual({ nome: "x", organizacao_id: A });
  });
  it("create com organizacao_id divergente falha", () => {
    expect(() => injetarEscopo("create", { data: { nome: "x", organizacao_id: B } }, A)).toThrow(TenantDivergenteGed);
  });
  it("create com relação organizacao: { connect } é recusado (misturaria formatos)", () => {
    expect(() => injetarEscopo("create", { data: { nome: "x", organizacao: { connect: { id: B } } } }, A)).toThrow(TenantDivergenteGed);
  });
  it("createMany/createManyAndReturn: lista e objeto único", () => {
    for (const op of ["createMany", "createManyAndReturn"]) {
      expect(injetarEscopo(op, { data: [{ n: 1 }, { n: 2, organizacao_id: A }] }, A).data).toEqual([{ n: 1, organizacao_id: A }, { n: 2, organizacao_id: A }]);
      expect(injetarEscopo(op, { data: { n: 1 } }, A).data).toEqual({ n: 1, organizacao_id: A });
      expect(() => injetarEscopo(op, { data: [{ n: 1 }, { n: 2, organizacao_id: B }] }, A)).toThrow(TenantDivergenteGed);
    }
  });
});

describe("injetarEscopo – segurança geral", () => {
  it("operação desconhecida é negada", () => {
    expect(() => injetarEscopo("findRaw", {}, A)).toThrow(/não suportada/);
  });
  it("organizacaoId inválido é negado", () => {
    expect(() => injetarEscopo("findMany", {}, "")).toThrow();
    expect(() => injetarEscopo("findMany", {}, "1; DROP TABLE")).toThrow();
  });
});

describe("erros", () => {
  it("naoEncontrado() é um ErroApi 404 (rota() responde 404)", () => {
    const e = naoEncontrado();
    expect(e).toBeInstanceOf(NaoEncontradoGed);
    expect(e.status).toBe(404);
    expect(e.code).toBe("NAO_ENCONTRADO");
  });
  it("TenantDivergenteGed é 403", () => {
    expect(new TenantDivergenteGed().status).toBe(403);
  });
});
