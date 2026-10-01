import { describe, expect, it } from "vitest";
import { documentoMascarado, FORMATO_SEIA, paraSeia, type ProcessoSeiaFonte } from "@/lib/integracao/seia";

const url = (c: string) => `https://app.exemplo/validar/${c}`;

const base = (extra: Partial<ProcessoSeiaFonte> = {}): ProcessoSeiaFonte => ({
  numero: "LOR-2026-000012",
  status: "DEFERIDO",
  data_protocolo: new Date("2026-03-02T13:00:00Z"),
  data_conclusao: new Date("2026-05-10T18:30:00Z"),
  created_at: new Date("2026-03-01T10:00:00Z"),
  updated_at: new Date("2026-05-10T18:30:00Z"),
  municipio: { codigo_ibge: "9900001", nome: "Lagoa do Orvalho", sigla: "LOR" },
  tipo_ato: { sigla: "LO", nome: "Licença de Operação" },
  empreendimento: {
    nome: "Laticínio Demonstração",
    latitude: { toNumber: () => -12.345678 },
    longitude: "-44.123456",
    numero_car: "BA-9900001-ABCD",
    porte: "PEQUENO",
    potencial_poluidor: "MEDIO",
    tipologia: { codigo: "C-02", descricao: "Laticínios", divisao: "Indústria" },
  },
  requerente: { nome: "Maria da Silva Souza", tipo: "PF", documento: "123.456.789-09", cpf_cnpj_mascara: "***.456.789-**" },
  documentos: [
    { tipo: "LICENCA", numero: "LO-LOR-001/2026", sigla_ato: "LO", emitido_em: new Date("2026-05-10T18:30:00Z"), validade_ate: new Date("2030-05-10T18:30:00Z"), status: "VALIDO", codigo_verificador: "7KQ2-M9XA-D3PL", sha256_pdf: "ab".repeat(32) },
    { tipo: "PARECER", numero: "PAR-LOR-003/2026", sigla_ato: null, emitido_em: new Date("2026-05-01T12:00:00Z"), validade_ate: null, status: "VALIDO", codigo_verificador: "AAAA-BBBB-CCCC", sha256_pdf: "cd".repeat(32) },
  ],
  ...extra,
});

describe("integração SEIA – mapeamento", () => {
  it("monta o item com município, ato, tipologia, porte, datas, empreendimento e documentos", () => {
    const r = paraSeia(base(), url);
    expect(r).toMatchObject({
      numero: "LOR-2026-000012",
      status: "DEFERIDO",
      municipio: { codigo_ibge: "9900001", nome: "Lagoa do Orvalho", sigla: "LOR" },
      tipo_ato: { sigla: "LO", nome: "Licença de Operação" },
      tipologia: { codigo: "C-02", nome: "Laticínios" },
      porte: "PEQUENO",
      potencial_poluidor: "MEDIO",
      datas: { protocolo: "2026-03-02T13:00:00.000Z", conclusao: "2026-05-10T18:30:00.000Z", atualizado_em: "2026-05-10T18:30:00.000Z" },
      empreendimento: { nome: "Laticínio Demonstração", latitude: -12.345678, longitude: -44.123456, numero_car: "BA-9900001-ABCD" },
    });
    expect(r.documentos).toEqual([
      { tipo: "LICENCA", numero: "LO-LOR-001/2026", sigla_ato: "LO", emitido_em: "2026-05-10T18:30:00.000Z", validade_ate: "2030-05-10T18:30:00.000Z", status: "VALIDO", url_validacao: "https://app.exemplo/validar/7KQ2-M9XA-D3PL", sha256: "ab".repeat(32) },
    ]);
    expect(FORMATO_SEIA).toMatch(/provisório/);
  });

  it("nunca expõe o CPF completo; CNPJ também mascarado", () => {
    const pf = paraSeia(base(), url);
    expect(pf.requerente).toEqual({ nome: "Maria da Silva Souza", tipo: "PF", documento: "***.456.789-**" });
    expect(JSON.stringify(pf)).not.toContain("123.456.789-09");
    expect(JSON.stringify(pf)).not.toContain("12345678909");

    const pj = paraSeia(base({ requerente: { nome: "Laticínio Demo Ltda", tipo: "PJ", documento: "12345678000195", cpf_cnpj_mascara: "12.345.678/****-**" } }), url);
    expect(pj.requerente.documento).toBe("12.345.678/****-**");
    expect(JSON.stringify(pj)).not.toContain("12345678000195");
  });

  it("sem documento decifrado usa a máscara salva; campos opcionais nulos", () => {
    expect(documentoMascarado(null, "***.111.222-**")).toBe("***.111.222-**");
    expect(documentoMascarado("", "")).toBe("***");
    const r = paraSeia(base({ data_conclusao: null, empreendimento: { ...base().empreendimento, latitude: null, longitude: undefined, numero_car: "", tipologia: null }, documentos: [] }), url);
    expect(r.datas.conclusao).toBeNull();
    expect(r.empreendimento).toMatchObject({ latitude: null, longitude: null, numero_car: null });
    expect(r.tipologia).toBeNull();
    expect(r.documentos).toEqual([]);
  });

  it("não inclui textos internos (despachos/pareceres/observações)", () => {
    const fonte = { ...base(), observacoes: "nota interna", despacho: "texto interno" } as ProcessoSeiaFonte;
    const s = JSON.stringify(paraSeia(fonte, url));
    expect(s).not.toContain("nota interna");
    expect(s).not.toContain("texto interno");
    expect(s).not.toContain("PAR-LOR-003");
  });
});
