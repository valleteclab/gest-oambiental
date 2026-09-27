import { describe, expect, it } from "vitest";
import { formatarCpfCnpj, mascararCpfCnpj, validarCNPJ, validarCPF, validarCpfCnpj } from "@/lib/crypto";
import { calcularPorte, faixasParaTexto, textoParaFaixas } from "@/lib/cadastros/porte";
import { EmpreendimentoSchema, erroDocumento, formatarEndereco, formParaObjeto, PessoaSchema } from "@/lib/cadastros/validacao";
import { parseTipologiasCsv } from "@/lib/admin/tipologias-csv";
import { gerarSenhaTemporaria } from "@/lib/admin/senha";
import { fmtDataPura, hojeDataPura } from "@/lib/cadastros/datas";

describe("CPF/CNPJ – dígitos verificadores", () => {
  it("CPF válidos e inválidos", () => {
    expect(validarCPF("529.982.247-25")).toBe(true);
    expect(validarCPF("11144477735")).toBe(true);
    expect(validarCPF("529.982.247-24")).toBe(false);
    expect(validarCPF("111.111.111-11")).toBe(false);
    expect(validarCPF("123")).toBe(false);
  });
  it("CNPJ válidos e inválidos", () => {
    expect(validarCNPJ("11.222.333/0001-81")).toBe(true);
    expect(validarCNPJ("45723174000110")).toBe(true);
    expect(validarCNPJ("11.222.333/0001-82")).toBe(false);
    expect(validarCNPJ("00000000000000")).toBe(false);
  });
  it("validarCpfCnpj decide pelo tamanho", () => {
    expect(validarCpfCnpj("52998224725")).toBe(true);
    expect(validarCpfCnpj("11222333000181")).toBe(true);
    expect(validarCpfCnpj("5299822472")).toBe(false);
  });
  it("erroDocumento exige o documento compatível com o tipo", () => {
    expect(erroDocumento("PF", "529.982.247-25")).toBeNull();
    expect(erroDocumento("PF", "11.222.333/0001-81")).toMatch(/11 dígitos/);
    expect(erroDocumento("PJ", "11.222.333/0001-81")).toBeNull();
    expect(erroDocumento("PJ", "11.222.333/0001-80")).toMatch(/inválido/);
  });
});

describe("máscaras", () => {
  it("máscara pública de CPF e CNPJ", () => {
    expect(mascararCpfCnpj("52998224725")).toBe("***.982.247-**");
    expect(mascararCpfCnpj("529.982.247-25")).toBe("***.982.247-**");
    expect(mascararCpfCnpj("11222333000181")).toBe("11.222.333/****-**");
    expect(mascararCpfCnpj("12")).toBe("***");
  });
  it("formatação completa (uso interno autorizado)", () => {
    expect(formatarCpfCnpj("52998224725")).toBe("529.982.247-25");
    expect(formatarCpfCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("PessoaSchema", () => {
  it("aceita PJ válida e normaliza campos vazios", () => {
    const r = PessoaSchema.parse({ tipo: "PJ", cpf_cnpj: "11.222.333/0001-81", nome: "Empresa X", email: "", municipio_id: "", endereco: { cep: "46.880-000", uf: "ba" } });
    expect(r.email).toBeNull();
    expect(r.municipio_id).toBeNull();
    expect(r.endereco?.cep).toBe("46880000");
    expect(r.endereco?.uf).toBe("BA");
  });
  it("rejeita CPF inválido, e-mail inválido e UF inexistente", () => {
    const r = PessoaSchema.safeParse({ tipo: "PF", cpf_cnpj: "111.111.111-11", nome: "Fulano", email: "x@", endereco: { uf: "XX" } });
    expect(r.success).toBe(false);
    const campos = r.error!.issues.map((i) => i.path.join("."));
    expect(campos).toEqual(expect.arrayContaining(["cpf_cnpj", "email", "endereco.uf"]));
  });
});

describe("porte (tipologia + grandeza)", () => {
  const faixas = [{ porte: "MICRO", ate: 500 }, { porte: "PEQUENO", ate: 2000 }, { porte: "MEDIO", ate: 5000 }, { porte: "GRANDE", ate: 10000 }, { porte: "EXCEPCIONAL", ate: null }];
  it("limites são inclusivos", () => {
    expect(calcularPorte(faixas, 0)).toBe("MICRO");
    expect(calcularPorte(faixas, 500)).toBe("MICRO");
    expect(calcularPorte(faixas, 500.01)).toBe("PEQUENO");
    expect(calcularPorte(faixas, 5000)).toBe("MEDIO");
    expect(calcularPorte(faixas, 10001)).toBe("EXCEPCIONAL");
    expect(calcularPorte(faixas, "1999")).toBe("PEQUENO");
  });
  it("sem grandeza, negativa ou sem faixas → null", () => {
    expect(calcularPorte(faixas, null)).toBeNull();
    expect(calcularPorte(faixas, "")).toBeNull();
    expect(calcularPorte(faixas, -1)).toBeNull();
    expect(calcularPorte([], 10)).toBeNull();
    expect(calcularPorte("lixo", 10)).toBeNull();
  });
  it("ordem das faixas no JSON não importa; sem faixa aberta, acima do teto → null", () => {
    expect(calcularPorte([{ porte: "GRANDE", ate: 100 }, { porte: "MICRO", ate: 10 }], 50)).toBe("GRANDE");
    expect(calcularPorte([{ porte: "MICRO", ate: 10 }], 50)).toBeNull();
  });
  it("texto ⇄ faixas", () => {
    const f = textoParaFaixas("MICRO:500|pequeno:2000|MEDIO:5000|GRANDE:10000|EXCEPCIONAL");
    expect(f).toEqual(faixas);
    expect(faixasParaTexto(f)).toBe("MICRO:500|PEQUENO:2000|MEDIO:5000|GRANDE:10000|EXCEPCIONAL");
    expect(() => textoParaFaixas("MICRO:500|PEQUENO:100")).toThrow(/crescentes/);
    expect(() => textoParaFaixas("MINI:5")).toThrow(/Porte inválido/);
    expect(() => textoParaFaixas("MICRO|GRANDE")).toThrow(/Apenas uma/);
  });
});

describe("EmpreendimentoSchema", () => {
  const base = { municipio_id: "11111111-1111-4111-8111-111111111111", requerente_id: "22222222-2222-4222-8222-222222222222", nome: "Posto Estrela", tipologia_id: "33333333-3333-4333-8333-333333333333" };
  it("converte números com vírgula e aceita polígono GeoJSON em texto", () => {
    const r = EmpreendimentoSchema.parse({ ...base, latitude: "-12,284200", longitude: "-40.4936", grandeza_porte: "90", porte: "", rt_id: "", poligono_geojson: '{"type":"Polygon","coordinates":[]}' });
    expect(r.latitude).toBeCloseTo(-12.2842);
    expect(r.grandeza_porte).toBe(90);
    expect(r.porte).toBeNull();
    expect(r.rt_id).toBeNull();
    expect(r.poligono_geojson).toEqual({ type: "Polygon", coordinates: [] });
  });
  it("rejeita coordenadas fora da faixa e GeoJSON inválido", () => {
    expect(EmpreendimentoSchema.safeParse({ ...base, latitude: 95 }).success).toBe(false);
    expect(EmpreendimentoSchema.safeParse({ ...base, poligono_geojson: "{x" }).success).toBe(false);
    expect(EmpreendimentoSchema.safeParse({ ...base, poligono_geojson: '{"type":"Point","coordinates":[0,0]}' }).success).toBe(false);
  });
});

describe("utilitários de formulário", () => {
  it("formParaObjeto aninha endereço", () => {
    const f = new FormData();
    f.set("nome", "X");
    f.set("endereco.cidade", "Iaçu");
    f.set("endereco.uf", "BA");
    expect(formParaObjeto(f)).toEqual({ nome: "X", endereco: { cidade: "Iaçu", uf: "BA" } });
  });
  it("formatarEndereco", () => {
    expect(formatarEndereco({ logradouro: "Rua A", numero: "10", bairro: "Centro", cidade: "Iaçu", uf: "BA", cep: "46860000" })).toBe("Rua A, 10 · Centro · Iaçu/BA · CEP 46860-000");
    expect(formatarEndereco({ uf: "BA" })).toBe("—");
    expect(formatarEndereco(null)).toBe("—");
  });
  it("datas puras (@db.Date) no fuso da Bahia", () => {
    expect(hojeDataPura(new Date("2026-09-28T01:30:00Z")).toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(fmtDataPura(new Date("2026-09-27T00:00:00Z"))).toBe("27/09/2026");
  });
});

describe("importação CSV de tipologias", () => {
  it("lê cabeçalho, aspas e faixas", () => {
    const r = parseTipologiasCsv('codigo;divisao;descricao;unidade_porte;potencial_poluidor;faixas\nC1.1;Indústria;"Laticínio; derivados";litros/dia;ALTO;MICRO:5000|PEQUENO:20000|EXCEPCIONAL\n');
    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ codigo: "C1.1", descricao: "Laticínio; derivados", potencial_poluidor: "ALTO" });
    expect(r.linhas[0].faixas_porte).toEqual([{ porte: "MICRO", ate: 5000 }, { porte: "PEQUENO", ate: 20000 }, { porte: "EXCEPCIONAL", ate: null }]);
  });
  it("aponta erros por linha", () => {
    const r = parseTipologiasCsv("A;B;C;D;MUITO;MICRO:1\nA2;B;C\nA3;B;C;D;BAIXO;MINI:1\nA4;B;C;D;médio;MICRO:1\nA4;B;C;D;BAIXO;MICRO:1");
    expect(r.linhas.map((l) => l.codigo)).toEqual(["A4"]);
    expect(r.linhas[0].potencial_poluidor).toBe("MEDIO");
    expect(r.erros.map((e) => e.linha)).toEqual([1, 2, 3, 5]);
  });
});

describe("senha temporária", () => {
  it("atende à política mínima (10+ caracteres, letra, dígito e símbolo)", () => {
    for (let i = 0; i < 50; i++) {
      const s = gerarSenhaTemporaria();
      expect(s.length).toBeGreaterThanOrEqual(10);
      expect(s).toMatch(/[A-Za-z]/);
      expect(s).toMatch(/\d/);
      expect(s).toMatch(/[@#$%&*!]/);
    }
  });
});
