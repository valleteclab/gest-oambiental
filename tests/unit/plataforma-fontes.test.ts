import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Varredura de fontes do painel /plataforma (docs/plataforma.md): a segurança não pode depender de lembrar de chamar o guarda.
const RAIZ = path.resolve(__dirname, "../..");

function listar(rel: string): string[] {
  const abs = path.join(RAIZ, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return /\.(ts|tsx)$/.test(abs) ? [rel] : [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => listar(path.posix.join(rel, e.name)));
}
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

describe("painel /plataforma – guardas em TODA entrada", () => {
  const PAINEL = "app/(plataforma)/plataforma";
  const arquivos = listar(PAINEL);

  it("existem páginas, layout e ações", () => {
    expect(arquivos.some((f) => f.endsWith("/layout.tsx"))).toBe(true);
    expect(arquivos.some((f) => f.endsWith("/page.tsx"))).toBe(true);
    expect(arquivos.some((f) => f.endsWith("/actions.ts"))).toBe(true);
  });

  it("toda página e layout chama o guarda de operador (404 para os demais)", () => {
    for (const f of arquivos.filter((x) => /\/(page|layout)\.tsx$/.test(x))) {
      expect(/exigirOperador\(|operadorDaPagina\(/.test(ler(f)), `${f} sem guarda de operador`).toBe(true);
    }
  });

  it("toda Server Action passa por exigirOperadorAcao/reautenticar/encerrarReautenticacao", () => {
    const src = ler(`${PAINEL}/actions.ts`);
    const acoes = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(acoes.length).toBeGreaterThan(5);
    for (const nome of acoes) {
      const corpo = src.slice(src.indexOf(`export async function ${nome}(`)).split(/\nexport async function /)[0];
      expect(/executar\(|reautenticar\(|encerrarReautenticacao\(/.test(corpo), `ação ${nome} sem guarda`).toBe(true);
    }
    expect(src).toMatch(/exigirOperadorAcao\(\)/);
  });

  it("o painel e o serviço não importam módulos de dados de negócio (processos, documentos, GED, cadastros)", () => {
    const proibidos = /@\/lib\/(processo|documentos|ged|cadastros|fiscalizacao|agente|cobranca|monitoramento)\b/;
    for (const f of [...arquivos, ...listar("lib/plataforma")]) {
      const src = ler(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(proibidos.test(src), `${f} importa módulo de dados de negócio`).toBe(false);
    }
  });

  it("operador_plataforma só é gravado pelo bootstrap (CLI/env) – nunca por telas de cliente", () => {
    const ESCRITA = /operadorPlataforma\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    const permitidos = new Set(["lib/plataforma/bootstrap.ts", "lib/plataforma/operador.ts"]);
    const todos = [...listar("app"), ...listar("lib"), ...listar("jobs"), ...listar("components")];
    for (const f of todos) {
      if (ESCRITA.test(ler(f))) expect(permitidos.has(f), `${f} grava operador_plataforma`).toBe(true);
    }
    // operador.ts só atualiza o último acesso
    for (const m of ler("lib/plataforma/operador.ts").matchAll(/operadorPlataforma\.update\(([^)]*)\)/g)) expect(m[1]).toMatch(/ultimo_acesso/);
  });

  it("nenhuma rota/serviço da plataforma oferece exclusão de cliente", () => {
    const src = [...arquivos, ...listar("lib/plataforma")].map(ler).join("\n");
    expect(src).not.toMatch(/organizacao\.(delete|deleteMany)\(/);
  });
});
