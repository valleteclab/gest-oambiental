import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Varre as fontes do módulo GED (docs/ged-design.md §1): o isolamento entre clientes depende de TODO acesso a banco
// passar por gedDb() (lib/ged/db.ts). Quem precisa de SQL cru é só lib/ged/busca.ts (com organizacao_id como parâmetro).
const RAIZ = path.resolve(__dirname, "../..");
const PERMITIDOS_DB = new Set(["lib/ged/db.ts"]);
const PERMITIDOS_SQL_CRU = new Set(["lib/ged/db.ts", "lib/ged/busca.ts"]);

function listar(rel: string): string[] {
  const abs = path.join(RAIZ, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return /\.(ts|tsx|mjs|js)$/.test(abs) ? [rel] : [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => listar(path.posix.join(rel, e.name)));
}

function fontesGed(): string[] {
  const jobs = existsSync(path.join(RAIZ, "jobs")) ? readdirSync(path.join(RAIZ, "jobs")).filter((n) => /^ged/.test(n)).map((n) => path.posix.join("jobs", n)) : [];
  return [...listar("lib/ged"), ...listar("app/(ged)"), ...listar("app/api/v1/ged"), ...listar("components/ged"), ...jobs.flatMap(listar),
    // protocolo público (sem sessão): o cliente vem do slug e TUDO passa por gedDb
    ...listar("app/(protocolo-publico)"), ...listar("app/api/v1/publico"), ...listar("components/protocolo"), ...listar("app/(publico)/verificar")];
}

/** Remove comentários (// e /* *​/) preservando strings simples; suficiente para a varredura. */
export function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Módulos importados/requeridos/`import()` por um arquivo. */
export function especificadores(src: string): string[] {
  const s = semComentarios(src);
  const out: string[] = [];
  for (const m of s.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

/** O especificador, visto de `arquivo`, aponta para lib/db? */
export function importaLibDb(arquivo: string, spec: string): boolean {
  if (/^@\/lib\/db(\.ts)?$/.test(spec)) return true;
  if (spec.startsWith(".")) {
    const alvo = path.posix.normalize(path.posix.join(path.posix.dirname(arquivo), spec)).replace(/\.(ts|js)$/, "");
    return alvo === "lib/db";
  }
  return /(^|\/)lib\/db(\.ts)?$/.test(spec);
}

const PADROES_SQL = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b/;

describe("fontes do GED", () => {
  const arquivos = fontesGed();

  it("encontra fontes para varrer", () => {
    expect(arquivos.length).toBeGreaterThan(10);
    expect(arquivos).toContain("lib/ged/db.ts");
  });

  it("só lib/ged/db.ts importa lib/db", () => {
    const violacoes = arquivos.filter((f) => !PERMITIDOS_DB.has(f)).filter((f) => especificadores(readFileSync(path.join(RAIZ, f), "utf8")).some((s) => importaLibDb(f, s)));
    expect(violacoes).toEqual([]);
  });

  it("ninguém instancia PrismaClient próprio nem usa prisma.ged*", () => {
    const violacoes: string[] = [];
    for (const f of arquivos.filter((x) => !PERMITIDOS_DB.has(x))) {
      const s = semComentarios(readFileSync(path.join(RAIZ, f), "utf8"));
      if (/new\s+PrismaClient\s*\(/.test(s)) violacoes.push(`${f}: new PrismaClient`);
      if (/\bprisma\s*\.\s*ged[A-Z]/.test(s)) violacoes.push(`${f}: prisma.ged*`);
      if (/\bprisma\s*\.\s*\$transaction/.test(s)) violacoes.push(`${f}: prisma.$transaction`);
    }
    expect(violacoes).toEqual([]);
  });

  it("SQL cru ($queryRaw/$executeRaw…) só em lib/ged/db.ts e lib/ged/busca.ts", () => {
    const violacoes = arquivos.filter((f) => !PERMITIDOS_SQL_CRU.has(f)).filter((f) => PADROES_SQL.test(semComentarios(readFileSync(path.join(RAIZ, f), "utf8"))));
    expect(violacoes).toEqual([]);
  });

  it("sem cache compartilhado/ISR em GED (unstable_cache, revalidate)", () => {
    const violacoes: string[] = [];
    for (const f of arquivos) {
      const s = semComentarios(readFileSync(path.join(RAIZ, f), "utf8"));
      if (/unstable_cache/.test(s)) violacoes.push(`${f}: unstable_cache`);
      if (/export\s+const\s+revalidate\b/.test(s)) violacoes.push(`${f}: export const revalidate`);
    }
    expect(violacoes).toEqual([]);
  });

  it("páginas, layouts e rotas declaram force-dynamic", () => {
    const alvo = arquivos.filter((f) => /(^|\/)(page|layout|route)\.tsx?$/.test(f) && (f.startsWith("app/(ged)") || f.startsWith("app/api/v1/ged")));
    expect(alvo.length).toBeGreaterThan(3);
    const sem = alvo.filter((f) => !/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(readFileSync(path.join(RAIZ, f), "utf8")));
    expect(sem).toEqual([]);
  });

  it("rotas de API usam rota() e ctxGedApi()", () => {
    const rotas = arquivos.filter((f) => f.startsWith("app/api/v1/ged") && /route\.ts$/.test(f));
    const sem = rotas.filter((f) => {
      const s = readFileSync(path.join(RAIZ, f), "utf8");
      return !/\brota\(/.test(s) || !/ctxGedApi\(/.test(s);
    });
    expect(sem).toEqual([]);
  });
});

describe("detector (autoteste)", () => {
  it("reconhece imports de lib/db em várias formas", () => {
    const f = "lib/ged/x.ts";
    expect(importaLibDb(f, "@/lib/db")).toBe(true);
    expect(importaLibDb(f, "../db")).toBe(true); // lib/ged/x.ts → lib/db
    expect(importaLibDb(f, "./db")).toBe(false); // lib/ged/db.ts
    expect(importaLibDb("lib/ged/documentos/y.ts", "../db")).toBe(false); // lib/ged/db.ts
    expect(importaLibDb("lib/ged/documentos/y.ts", "../../db")).toBe(true);
    expect(importaLibDb("app/(ged)/ged/page.tsx", "../../../lib/db")).toBe(true);
    expect(importaLibDb(f, "@/lib/ged/db")).toBe(false);
    expect(importaLibDb(f, "@prisma/client")).toBe(false);
  });
  it("extrai especificadores e ignora comentários", () => {
    const src = `// import { prisma } from "@/lib/db";\n/* import x from "@/lib/db" */\nimport a from "@/lib/ged/db";\nconst b = await import("@/lib/db");\nconst c = require("../db");`;
    expect(especificadores(src)).toEqual(["@/lib/ged/db", "@/lib/db", "../db"]);
  });
  it("detecta SQL cru", () => {
    expect(PADROES_SQL.test("await tx.$queryRaw`select 1`")).toBe(true);
    expect(PADROES_SQL.test("db.$executeRawUnsafe('x')")).toBe(true);
    expect(PADROES_SQL.test("// $queryRaw só em db.ts")).toBe(true); // o filtro de comentários é aplicado antes, no uso real
    expect(PADROES_SQL.test(semComentarios("// $queryRaw só em db.ts\nconst x = 1;"))).toBe(false);
  });
});
