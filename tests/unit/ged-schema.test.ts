import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { filtroTabela, type EscopoExportacao } from "@/lib/export/exportar";
import { camposExportados, DESCRICAO_TABELA } from "@/lib/export/dicionario";

// Defesa em profundidade do isolamento por cliente (docs/ged-design.md §1): toda tabela Ged* precisa de organizacao_id,
// índice com ele na frente, regra de escopo na exportação e descrição no dicionário.
const modelosGed = Prisma.dmmf.datamodel.models.filter((m) => m.name.startsWith("Ged"));
const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");

/** Modelos cujo índice/unique "natural" não começa por organizacao_id (consultados sempre por usuario_id, que já é do tenant). */
const SEM_INDICE_ORG_NA_FRENTE = new Set(["GedPreferenciaNotificacao"]);

function blocoModelo(nome: string) {
  const m = new RegExp(`model ${nome} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!m) throw new Error(`modelo ${nome} não encontrado no schema`);
  return m[1];
}

const ORG_FAKE = "11111111-1111-4111-8111-111111111111";
const escopoFake: EscopoExportacao = { organizacao: { id: ORG_FAKE, nome: "Cliente Fictício", sigla: "CF" }, municipios: [], usuarios: [], emails: [] };

describe("schema GED", () => {
  it("há modelos Ged*", () => {
    expect(modelosGed.length).toBeGreaterThanOrEqual(20);
  });

  for (const m of modelosGed) {
    describe(m.name, () => {
      it("tem organizacao_id uuid obrigatório", () => {
        const f = m.fields.find((x) => x.name === "organizacao_id");
        expect(f, "campo organizacao_id").toBeTruthy();
        expect(f!.isRequired).toBe(true);
        expect(f!.type).toBe("String");
        expect(f!.nativeType?.[0]).toBe("Uuid");
      });

      it("tem índice ou unique começando por organizacao_id", () => {
        if (SEM_INDICE_ORG_NA_FRENTE.has(m.name)) return;
        const bloco = blocoModelo(m.name);
        const temIndice = /@@(index|unique)\(\[\s*organizacao_id\b/.test(bloco);
        const temUniqueDmmf = m.uniqueIndexes.some((u) => u.fields[0] === "organizacao_id");
        expect(temIndice || temUniqueDmmf).toBe(true);
      });

      it("tem regra de escopo na exportação (filtroTabela) por organizacao_id", () => {
        const w = filtroTabela(m.name, escopoFake);
        expect(w).toEqual({ organizacao_id: ORG_FAKE });
      });

      it("está no dicionário de dados", () => {
        expect(DESCRICAO_TABELA[m.name]).toBeTruthy();
      });

      it("não exporta tsv/Unsupported", () => {
        const colunas = camposExportados(m).map((f) => f.name);
        expect(colunas).not.toContain("tsv");
        expect(m.fields.some((f) => /^Unsupported/i.test(f.type))).toBe(false);
      });
    });
  }

  it("a coluna tsv existe só em GedConteudoTexto (fora do DMMF) e não é exportada", () => {
    expect(blocoModelo("GedConteudoTexto")).toMatch(/tsv\s+Unsupported\("tsvector"\)/);
    for (const m of modelosGed) if (m.name !== "GedConteudoTexto") expect(blocoModelo(m.name)).not.toMatch(/Unsupported\(/);
  });

  it("relações de modelos Ged* para Organizacao existem (FK)", () => {
    for (const m of modelosGed) {
      expect(m.fields.some((f) => f.kind === "object" && f.type === "Organizacao"), `${m.name} → Organizacao`).toBe(true);
    }
  });
});
