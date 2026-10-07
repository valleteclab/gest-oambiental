// Onboarding de clientes GED (prisma/seed/onboarding.ts): validação do JSON, expansão de pastas e regras puras.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ClienteSchema, expandirPastas, setorDeUsuario, unirModulos } from "../../prisma/seed/onboarding";

const DIR = path.resolve(__dirname, "../../prisma/seed/clientes");
const lerJson = (n: string) => JSON.parse(readFileSync(path.join(DIR, n), "utf8"));
const base = { organizacao: { nome: "Cliente Fictício", sigla: "CLF" } };
const gedMin = { setores: [{ nome: "Protocolo", sigla: "PROT" }] };
const msgs = (r: ReturnType<typeof ClienteSchema.safeParse>) => (r.success ? [] : r.error.issues.map((i) => i.message));

describe("ClienteSchema – módulos", () => {
  it("padrão = LICENCIAMENTO (JSONs de clientes existentes não mudam)", () => {
    const r = ClienteSchema.parse(lerJson("riachao-das-neves.json"));
    expect(r.modulos).toEqual(["LICENCIAMENTO"]);
    expect(r.municipios.length).toBeGreaterThan(0);
    expect(r.ged).toBeUndefined();
  });

  it("todos os JSONs de clientes da pasta continuam válidos", () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
      const r = ClienteSchema.safeParse(lerJson(f));
      expect(r.success, `${f}: ${msgs(r).join("; ")}`).toBe(true);
    }
  });

  it("LICENCIAMENTO exige município e papel por usuário", () => {
    expect(msgs(ClienteSchema.safeParse({ ...base, modulos: ["LICENCIAMENTO"] }))).toContain("o módulo LICENCIAMENTO exige ao menos 1 município/órgão");
    const m = { nome: "Lagoa", sigla: "LAG", codigo_ibge: "9900001", orgao_ambiental_nome: "Secretaria de Meio Ambiente" };
    const r = ClienteSchema.safeParse({ ...base, municipios: [m], usuarios: [{ email: "a@b.demo", nome: "Fulano de Tal", papeis: [] }] });
    expect(msgs(r).join(" ")).toMatch(/ao menos 1 papel/);
  });

  it("cliente só-GED: sem municípios, sem usuários de licenciamento, sem catálogo", () => {
    expect(ClienteSchema.safeParse({ ...base, modulos: ["GED"], ged: gedMin }).success).toBe(true);
    const m = { nome: "Lagoa", sigla: "LAG", codigo_ibge: "9900001", orgao_ambiental_nome: "Secretaria de Meio Ambiente" };
    expect(msgs(ClienteSchema.safeParse({ ...base, modulos: ["GED"], municipios: [m] })).join(" ")).toMatch(/não tem municípios/);
    expect(msgs(ClienteSchema.safeParse({ ...base, modulos: ["GED"], usuarios: [{ email: "a@b.demo", nome: "Fulano de Tal", papeis: [{ papel: "ADMIN" }] }] })).join(" ")).toMatch(/use ged\.usuarios/);
  });

  it("bloco ged exige o módulo GED; módulos desconhecidos são rejeitados", () => {
    const m = { nome: "Lagoa", sigla: "LAG", codigo_ibge: "9900001", orgao_ambiental_nome: "Secretaria de Meio Ambiente" };
    expect(msgs(ClienteSchema.safeParse({ ...base, municipios: [m], ged: gedMin })).join(" ")).toMatch(/exige "GED"/);
    expect(ClienteSchema.safeParse({ ...base, modulos: ["GED", "COBRANCA"], ged: gedMin }).success).toBe(false);
    expect(ClienteSchema.safeParse({ ...base, modulos: [], ged: gedMin }).success).toBe(false);
  });

  it("híbrido (LICENCIAMENTO + GED) é aceito", () => {
    const m = { nome: "Lagoa", sigla: "LAG", codigo_ibge: "9900001", orgao_ambiental_nome: "Secretaria de Meio Ambiente" };
    const r = ClienteSchema.safeParse({ ...base, modulos: ["LICENCIAMENTO", "GED"], municipios: [m], ged: gedMin });
    expect(r.success).toBe(true);
  });
});

describe("ClienteSchema – bloco ged", () => {
  const ged = (extra: object) => ({ ...base, modulos: ["GED"], ged: { ...gedMin, ...extra } });
  const usuario = { email: "A@Demo.Test", nome: "Maria Souza", papel_ged: "GED_USUARIO", setores: ["prot"] };

  it("normaliza e-mail/sigla e aceita setor como string ou { sigla, chefe }", () => {
    const r = ClienteSchema.parse(ged({ usuarios: [{ ...usuario, setores: ["prot", { sigla: "PROT", chefe: true }] }] }));
    expect(r.ged!.usuarios[0].email).toBe("a@demo.test");
    expect(r.ged!.usuarios[0].setores.map(setorDeUsuario)).toEqual([{ sigla: "PROT", chefe: false }, { sigla: "PROT", chefe: true }]);
  });

  it("papel_ged inválido, setor inexistente e duplicidades são rejeitados", () => {
    expect(ClienteSchema.safeParse(ged({ usuarios: [{ ...usuario, papel_ged: "ADMIN" }] })).success).toBe(false);
    expect(msgs(ClienteSchema.safeParse(ged({ usuarios: [{ ...usuario, setores: ["XYZ"] }] }))).join(" ")).toMatch(/setor XYZ não está em ged\.setores/);
    expect(msgs(ClienteSchema.safeParse(ged({ usuarios: [usuario, usuario] }))).join(" ")).toMatch(/duplicado/);
    expect(msgs(ClienteSchema.safeParse(ged({ setores: [...gedMin.setores, { nome: "Outro", sigla: "prot" }] }))).join(" ")).toMatch(/setor duplicado/);
    expect(msgs(ClienteSchema.safeParse(ged({ tipos_documento: ["Ofício", "ofício"] }))).join(" ")).toMatch(/tipo de documento duplicado/);
    expect(msgs(ClienteSchema.safeParse(ged({ marcadores: [{ nome: "Urgente" }, { nome: "URGENTE" }] }))).join(" ")).toMatch(/marcador duplicado/);
  });

  it("config e cor validadas", () => {
    expect(ClienteSchema.safeParse(ged({ config: { assinatura_prazo_dias: 0 } })).success).toBe(false);
    expect(ClienteSchema.safeParse(ged({ config: { lembrete_dias: [3, 1, 0], cota_bytes: 5_000_000_000 } })).success).toBe(true);
    expect(ClienteSchema.safeParse(ged({ marcadores: [{ nome: "Urgente", cor: "vermelho" }] })).success).toBe(false);
  });

  it("caminho de pasta inválido vira erro de validação", () => {
    expect(msgs(ClienteSchema.safeParse(ged({ pastas: [{ caminho: "A//B" }] }))).join(" ")).toMatch(/segmento vazio/);
  });

  it("os JSONs de demonstração (ged-demo-a/b) são válidos e só-GED", () => {
    for (const [f, sigla] of [["ged-demo-a.json", "VAC"], ["ged-demo-b.json", "AAC"]] as const) {
      const r = ClienteSchema.parse(lerJson(f));
      expect(r.modulos).toEqual(["GED"]);
      expect(r.organizacao.sigla).toBe(sigla);
      expect(r.municipios).toEqual([]);
      expect(r.ged!.usuarios.every((u) => u.email.endsWith("@gestaodocumentos.demo"))).toBe(true);
    }
  });
});

describe("expandirPastas", () => {
  it("cria as pastas intermediárias, pai antes do filho", () => {
    const plano = expandirPastas([{ caminho: "Processos de pagamento/2026/Empenhos" }, { caminho: "Controle interno/Relatórios" }]);
    expect(plano.map((p) => p.caminho)).toEqual([
      "Processos de pagamento", "Controle interno", "Processos de pagamento/2026", "Controle interno/Relatórios", "Processos de pagamento/2026/Empenhos",
    ]);
    expect(plano.find((p) => p.caminho === "Processos de pagamento/2026")).toMatchObject({ nome: "2026", pai: "Processos de pagamento", herda_acl: true });
    expect(plano.find((p) => p.caminho === "Controle interno")!.pai).toBeNull();
  });

  it("padrões: herda_acl=true; sensibilidade RESTRITO na raiz e herdada do pai quando omitida", () => {
    const plano = expandirPastas([
      { caminho: "Pessoal", herda_acl: false, sensibilidade_padrao: "SIGILOSO" },
      { caminho: "Pessoal/Folha" },
      { caminho: "Pessoal/Publicações", sensibilidade_padrao: "PUBLICO" },
      { caminho: "Geral" },
    ]);
    const p = (c: string) => plano.find((x) => x.caminho === c)!;
    expect(p("Pessoal")).toMatchObject({ herda_acl: false, sensibilidade_padrao: "SIGILOSO" });
    expect(p("Pessoal/Folha")).toMatchObject({ herda_acl: true, sensibilidade_padrao: "SIGILOSO" });
    expect(p("Pessoal/Publicações").sensibilidade_padrao).toBe("PUBLICO");
    expect(p("Geral").sensibilidade_padrao).toBe("RESTRITO");
  });

  it("entrada explícita de uma pasta já intermediária aplica suas opções (qualquer ordem)", () => {
    const plano = expandirPastas([{ caminho: "A/B/C" }, { caminho: "A", sensibilidade_padrao: "PUBLICO" }]);
    expect(plano.map((p) => [p.caminho, p.sensibilidade_padrao])).toEqual([["A", "PUBLICO"], ["A/B", "PUBLICO"], ["A/B/C", "PUBLICO"]]);
  });

  it("duplicidade (sem diferenciar maiúsculas), segmento vazio e profundidade excessiva falham", () => {
    expect(() => expandirPastas([{ caminho: "A/B" }, { caminho: "a/b" }])).toThrow(/duplicada/);
    expect(() => expandirPastas([{ caminho: "/A" }])).toThrow(/segmento vazio/);
    expect(() => expandirPastas([{ caminho: "A/ /B" }])).toThrow(/segmento vazio/);
    expect(() => expandirPastas([{ caminho: "1/2/3/4/5/6/7/8/9" }])).toThrow(/profundidade/);
    expect(() => expandirPastas([{ caminho: "A".repeat(121) }])).toThrow(/nome inválido/);
  });

  it("apara espaços e é determinística", () => {
    const a = expandirPastas([{ caminho: " A / B " }]);
    expect(a.map((p) => p.caminho)).toEqual(["A", "A/B"]);
    expect(expandirPastas([{ caminho: " A / B " }])).toEqual(a);
  });
});

describe("unirModulos", () => {
  it("união estável, sem duplicar nem remover", () => {
    expect(unirModulos([], ["GED"])).toEqual(["GED"]);
    expect(unirModulos(["LICENCIAMENTO"], ["GED"])).toEqual(["LICENCIAMENTO", "GED"]);
    expect(unirModulos(["GED", "LICENCIAMENTO"], ["GED"])).toEqual(["LICENCIAMENTO", "GED"]);
    expect(unirModulos(["LICENCIAMENTO"], ["LICENCIAMENTO"])).toEqual(["LICENCIAMENTO"]);
  });
});
