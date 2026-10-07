import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TABELAS_APAGADAS,
  TABELAS_PRESERVADAS,
  chaveDaOrg,
  confirmacaoValida,
  interpretarArgs,
  prefixoStorageOrg,
  sqlApagar,
  sqlContar,
  validarSqlLimpeza,
} from "../../scripts/ged/plano-limpeza";

// Limpeza do conteúdo do GED de um cliente (scripts/ged/limpar-organizacao.ts, docs/ged.md §15): testes PUROS do plano.
const RAIZ = path.resolve(__dirname, "../..");
const schema = readFileSync(path.join(RAIZ, "prisma/schema.prisma"), "utf8");
const ORG = "0b9f6a52-7a3e-4c63-9f0a-2f4b5d6e7a8b";

type Modelo = { nome: string; tabela: string; temOrg: boolean; fks: string[] };
function modelosGed(): Modelo[] {
  const out: Modelo[] = [];
  for (const m of schema.matchAll(/^model (Ged\w+) \{([\s\S]*?)^\}/gm)) {
    const corpo = m[2];
    const tabela = /@@map\("([^"]+)"\)/.exec(corpo)?.[1] ?? "";
    const temOrg = /^\s*organizacao_id\s+String\s+@db\.Uuid/m.test(corpo);
    const fks: string[] = [];
    for (const l of corpo.split("\n")) {
      const f = /^\s*\w+\s+(Ged\w+)\??(?:\[\])?\s+.*@relation\([^)]*fields:\s*\[/.exec(l);
      if (f) fks.push(f[1]);
    }
    out.push({ nome: m[1], tabela, temOrg, fks });
  }
  return out;
}
const MODELOS = modelosGed();

describe("plano de limpeza do GED", () => {
  it("lê as tabelas Ged* e suas FKs do schema", () => {
    expect(MODELOS.length).toBeGreaterThan(20);
    expect(MODELOS.find((m) => m.nome === "GedVersaoDocumento")!.fks).toContain("GedDocumento");
    expect(MODELOS.find((m) => m.nome === "GedAssinante")!.fks).toContain("GedSolicitacaoAssinatura");
    expect(MODELOS.find((m) => m.nome === "GedProtocoloEvento")!.fks).toContain("GedProtocolo");
  });

  it("toda tabela Ged* do schema está em APAGADAS ou PRESERVADAS (tabela nova sem entrada falha aqui)", () => {
    const plano = [...TABELAS_APAGADAS, ...TABELAS_PRESERVADAS];
    const faltam = MODELOS.filter((m) => !plano.some((t) => t.modelo === m.nome)).map((m) => m.nome);
    expect(faltam, `Adicione em scripts/ged/plano-limpeza.ts (APAGADAS ou PRESERVADAS): ${faltam.join(", ")}`).toEqual([]);
    const sobram = plano.filter((t) => !MODELOS.some((m) => m.nome === t.modelo)).map((t) => t.modelo);
    expect(sobram).toEqual([]);
    for (const t of plano) expect(MODELOS.find((m) => m.nome === t.modelo)!.tabela).toBe(t.tabela);
    expect(new Set(plano.map((t) => t.modelo)).size).toBe(plano.length); // sem duplicata nem tabela nas duas listas
  });

  it("toda tabela do plano tem organizacao_id (único filtro de isolamento)", () => {
    for (const m of MODELOS) expect(m.temOrg, m.nome).toBe(true);
  });

  it("ordem de dependência: filho é apagado antes do pai", () => {
    const pos = new Map(TABELAS_APAGADAS.map((t, i) => [t.modelo, i]));
    for (const m of MODELOS) {
      if (!pos.has(m.nome)) continue;
      for (const pai of m.fks) {
        if (pai === m.nome) continue; // auto-referência (pasta, documento): um único DELETE
        if (!pos.has(pai)) continue; // pai preservado
        expect(pos.get(m.nome)!, `${m.nome} deve vir antes de ${pai}`).toBeLessThan(pos.get(pai)!);
      }
    }
  });

  it("tabela preservada não pode ter FK para tabela apagada (ficaria órfã)", () => {
    const apagadas = new Set(TABELAS_APAGADAS.map((t) => t.modelo));
    for (const t of TABELAS_PRESERVADAS) {
      const m = MODELOS.find((x) => x.nome === t.modelo)!;
      expect(m.fks.filter((p) => apagadas.has(p)), t.modelo).toEqual([]);
    }
  });

  it("preserva membros, setores, configuração e tipos; apaga documentos, protocolos, importações e assinaturas", () => {
    const pres = TABELAS_PRESERVADAS.map((t) => t.modelo);
    for (const n of ["GedMembro", "GedSetor", "GedConfig", "GedTipoDocumento"]) expect(pres).toContain(n);
    const apag = TABELAS_APAGADAS.map((t) => t.modelo);
    for (const n of ["GedDocumento", "GedVersaoDocumento", "GedPasta", "GedProtocolo", "GedProtocoloEvento", "GedImportacao", "GedAssinante", "GedTramite", "GedComentario", "GedAcessoLog", "GedComunicacao", "GedMarcador"]) {
      expect(apag).toContain(n);
    }
  });
});

describe("guarda de filtro por organização", () => {
  it("todo SQL gerado filtra por organizacao_id = $1", () => {
    for (const t of [...TABELAS_APAGADAS, ...TABELAS_PRESERVADAS]) {
      expect(validarSqlLimpeza(sqlContar(t.tabela))).toMatch(/WHERE "organizacao_id" = \$1::uuid$/);
    }
    for (const t of TABELAS_APAGADAS) {
      const sql = sqlApagar(t.tabela);
      expect(sql).toBe(`DELETE FROM "${t.tabela}" WHERE "organizacao_id" = $1::uuid`);
      expect(validarSqlLimpeza(sql)).toBe(sql);
    }
  });

  it("recusa DELETE sem filtro, com filtro diferente, em tabela fora do plano ou com SQL extra", () => {
    const ruins = [
      'DELETE FROM "ged_documento"',
      'DELETE FROM "ged_documento" WHERE 1=1',
      'DELETE FROM "ged_documento" WHERE "organizacao_id" = $1::uuid OR true',
      'DELETE FROM "ged_documento" WHERE "organizacao_id" = $1::uuid; DELETE FROM "usuario"',
      'DELETE FROM "usuario" WHERE "organizacao_id" = $1::uuid',
      'DELETE FROM "log_auditoria" WHERE "organizacao_id" = $1::uuid',
      'DELETE FROM "ged_inexistente" WHERE "organizacao_id" = $1::uuid',
      'TRUNCATE "ged_documento"',
      'DELETE FROM "ged_documento" WHERE "organizacao_id" = \'x\'',
    ];
    for (const s of ruins) expect(() => validarSqlLimpeza(s), s).toThrow();
  });

  it("não gera DELETE para tabela preservada nem desconhecida", () => {
    for (const t of TABELAS_PRESERVADAS) expect(() => sqlApagar(t.tabela)).toThrow();
    expect(() => sqlApagar("log_auditoria")).toThrow();
    expect(() => sqlContar("usuario")).toThrow();
  });

  it("o executor só emite DELETE via sqlApagar/validarSqlLimpeza (varredura da fonte)", () => {
    const fonte = readFileSync(path.join(RAIZ, "scripts/ged/limpar-organizacao.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/DELETE\s+FROM/i);
    expect(fonte).not.toMatch(/TRUNCATE/i);
    expect(fonte).not.toMatch(/deleteMany|\.delete\(/);
    for (const m of fonte.matchAll(/\$executeRawUnsafe\(([^)]*)\)/g)) {
      expect(m[1], m[0]).toMatch(/validarSqlLimpeza|SET LOCAL session_replication_role = 'replica'|ALTER TABLE "\$\{g\.tabela\}" DISABLE TRIGGER "\$\{g\.nome\}"/);
    }
  });
});

describe("storage por cliente e linha de comando", () => {
  it("prefixo é ged/{org}/ e chaves de outro cliente são recusadas", () => {
    expect(prefixoStorageOrg(ORG.toUpperCase())).toBe(`ged/${ORG}/`);
    expect(() => prefixoStorageOrg("../x")).toThrow();
    expect(chaveDaOrg(ORG, `ged/${ORG}/2026/doc/v1-abcd1234.pdf`)).toBe(true);
    expect(chaveDaOrg(ORG, `ged/${ORG}/importacao/i.zip`)).toBe(true);
    expect(chaveDaOrg(ORG, "ged/1b9f6a52-7a3e-4c63-9f0a-2f4b5d6e7a8b/2026/x.pdf")).toBe(false);
    expect(chaveDaOrg(ORG, `ged/${ORG}`)).toBe(false);
    expect(chaveDaOrg(ORG, `ged/${ORG}/../outra/x.pdf`)).toBe(false);
    expect(chaveDaOrg(ORG, `ged/${ORG}x/a.pdf`)).toBe(false);
    expect(chaveDaOrg(ORG, "licenca/x.pdf")).toBe(false);
  });

  it("argumentos: dry-run por padrão; executar e confirmar explícitos", () => {
    expect(interpretarArgs(["VAC"])).toEqual({ alvo: "VAC", executar: false, confirmar: null, manterDemo: false });
    expect(interpretarArgs(["VAC", "--executar", "--confirmar=VAC"])).toMatchObject({ executar: true, confirmar: "VAC" });
    expect(interpretarArgs(["--manter-demo", ORG]).manterDemo).toBe(true);
    expect(() => interpretarArgs([])).toThrow();
    expect(() => interpretarArgs(["VAC", "AAC"])).toThrow();
    expect(() => interpretarArgs(["VAC,AAC"])).toThrow();
    expect(() => interpretarArgs(["VAC", "--tudo"])).toThrow();
  });

  it("confirmação exige a sigla exata", () => {
    expect(confirmacaoValida("VAC", "VAC")).toBe(true);
    expect(confirmacaoValida("VAC", "vac")).toBe(false);
    expect(confirmacaoValida("VAC", "AAC")).toBe(false);
    expect(confirmacaoValida("VAC", null)).toBe(false);
    expect(confirmacaoValida("VAC", "")).toBe(false);
  });
});
