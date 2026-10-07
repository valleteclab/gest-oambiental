import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OCR do GED (fase 2): decisão, cota, mapeamento de status e chamada do binário (spawn mockado). Sem banco, sem ocrmypdf real.
type Cenario = { codigo?: number; erroSpawn?: string; saida?: Buffer | null; travar?: boolean };
const estado: { cenario: Cenario; chamadas: { bin: string; args: string[]; env?: NodeJS.ProcessEnv }[]; mortes: string[] } = { cenario: {}, chamadas: [], mortes: [] };

vi.mock("node:child_process", () => ({
  spawn: (bin: string, args: string[], opc?: { env?: NodeJS.ProcessEnv }) => {
    estado.chamadas.push({ bin, args, env: opc?.env });
    const filho = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (s?: string) => boolean };
    filho.stdout = new EventEmitter();
    filho.stderr = new EventEmitter();
    filho.kill = (s) => {
      estado.mortes.push(s ?? "SIGTERM");
      setImmediate(() => filho.emit("close", null, s ?? "SIGTERM"));
      return true;
    };
    const c = estado.cenario;
    setImmediate(() => {
      if (c.erroSpawn) return filho.emit("error", Object.assign(new Error(c.erroSpawn), { code: "ENOENT" }));
      if (c.travar) return; // só o timeout encerra
      if (args[0] === "--version") return filho.emit("close", c.codigo ?? 0, null);
      if (c.saida) writeFileSync(args[args.length - 1], c.saida);
      if ((c.codigo ?? 0) !== 0) filho.stderr.emit("data", Buffer.from("erro simulado do ocrmypdf"));
      filho.emit("close", c.codigo ?? 0, null);
    });
    return filho;
  },
}));

import {
  apresentacaoOcr,
  avaliarCota,
  classificarSaidaOcr,
  COTA_OCR_PADRAO_PAGINAS_MES,
  decidirOcr,
  elegivelParaOcr,
  erroDeLimites,
  inicioDoMesBrasilia,
  limitesOcr,
  ocrReprocessavel,
  podeReprocessarOcrPapel,
  statusDaSaida,
} from "@/lib/ged/ocr/decisao";
import { _limparCacheOcr, argumentosOcr, binarioOcr, executarOcr, ocrDisponivel } from "@/lib/ged/ocr/executar";
import { ORIGENS_QUE_CANCELAM_ASSINATURA } from "@/lib/ged/documentos/versoes";

const PDF = "application/pdf";
const palavras = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(" ");

beforeEach(() => {
  estado.cenario = {};
  estado.chamadas = [];
  estado.mortes = [];
  _limparCacheOcr();
});
afterEach(() => vi.unstubAllEnvs());

describe("decidirOcr – precisa de OCR?", () => {
  it("PDF sem texto extraível → precisa", () => {
    expect(decidirOcr({ mime: PDF, texto: "\f\f", paginas: 2 })).toEqual({ precisa: true, motivo: "SEM_TEXTO" });
    expect(decidirOcr({ mime: PDF, texto: "  \n ", paginas: 1 }).precisa).toBe(true);
  });
  it("texto muito curto por página → precisa", () => {
    expect(decidirOcr({ mime: PDF, texto: "Pág 1\f2\f", paginas: 3 }).precisa).toBe(true);
  });
  it("PDF com texto suficiente → não precisa", () => {
    expect(decidirOcr({ mime: PDF, texto: `${palavras(30)}\f${palavras(30)}\f`, paginas: 2 })).toEqual({ precisa: false, motivo: "TEM_TEXTO" });
  });
  it("PDF misto (metade das páginas sem texto) → precisa", () => {
    const texto = `${palavras(200)}\f\f\f\f`; // 1 página com texto, 3 de imagem
    expect(decidirOcr({ mime: PDF, texto, paginas: 4 })).toEqual({ precisa: true, motivo: "PAGINAS_SEM_TEXTO" });
  });
  it("PDF com poucas páginas vazias (capa/verso) → não precisa", () => {
    const texto = `${palavras(40)}\f${palavras(40)}\f${palavras(40)}\f\f`;
    expect(decidirOcr({ mime: PDF, texto, paginas: 4 }).precisa).toBe(false);
  });
  it("imagens PNG/JPG/TIFF → sempre; outros tipos → não", () => {
    for (const mime of ["image/png", "image/jpeg", "image/tiff"]) expect(decidirOcr({ mime, texto: null, paginas: null })).toEqual({ precisa: true, motivo: "IMAGEM" });
    expect(decidirOcr({ mime: "text/plain", texto: "", paginas: null }).precisa).toBe(false);
  });
  it("extração indisponível (texto nulo) não decide por OCR", () => {
    expect(decidirOcr({ mime: PDF, texto: null, paginas: 3 }).precisa).toBe(false);
  });
});

describe("elegibilidade (nunca em selado/assinado; sem laço)", () => {
  const base = { origem: "UPLOAD" as const, selada: false, statusDocumento: "PUBLICADO", documentoTemVersaoSelada: false };
  it("upload/scan elegíveis", () => {
    expect(elegivelParaOcr(base).ok).toBe(true);
    expect(elegivelParaOcr({ ...base, origem: "SCAN" }).ok).toBe(true);
    expect(elegivelParaOcr({ ...base, statusDocumento: "EM_ASSINATURA" }).ok).toBe(true); // não cancela nem bloqueia a assinatura aberta
  });
  it("selada, ASSINADO, com versão selada ou ARQUIVADO → recusa", () => {
    expect(elegivelParaOcr({ ...base, selada: true }).ok).toBe(false);
    expect(elegivelParaOcr({ ...base, statusDocumento: "ASSINADO" }).ok).toBe(false);
    expect(elegivelParaOcr({ ...base, documentoTemVersaoSelada: true }).ok).toBe(false);
    expect(elegivelParaOcr({ ...base, statusDocumento: "ARQUIVADO" }).ok).toBe(false);
  });
  it("versões OCR/SELO/EDITOR/ANONIMIZACAO nunca voltam ao OCR", () => {
    for (const origem of ["OCR", "SELO", "EDITOR", "ANONIMIZACAO"] as const) expect(elegivelParaOcr({ ...base, origem }).ok).toBe(false);
  });
  it("a versão OCR NÃO cancela solicitação de assinatura aberta", () => {
    expect(ORIGENS_QUE_CANCELAM_ASSINATURA).not.toContain("OCR");
    expect(ORIGENS_QUE_CANCELAM_ASSINATURA).toEqual(expect.arrayContaining(["UPLOAD", "EDITOR", "SCAN"]));
  });
});

describe("cota mensal de páginas", () => {
  it("dentro da cota", () => expect(avaliarCota({ cota: 100, usadas: 40, paginas: 60 })).toMatchObject({ ok: true, restantes: 60 }));
  it("estoura por 1 página", () => expect(avaliarCota({ cota: 100, usadas: 40, paginas: 61 }).ok).toBe(false));
  it("cota nula = sem limite; cota 0 = OCR desligado", () => {
    expect(avaliarCota({ cota: null, usadas: 1e9, paginas: 500 }).ok).toBe(true);
    expect(avaliarCota({ cota: 0, usadas: 0, paginas: 1 }).ok).toBe(false);
  });
  it("padrão generoso", () => expect(COTA_OCR_PADRAO_PAGINAS_MES).toBeGreaterThanOrEqual(5000));
  it("o mês vira à meia-noite de Brasília (UTC-3)", () => {
    expect(inicioDoMesBrasilia(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(inicioDoMesBrasilia(new Date("2026-10-01T02:59:00Z")).toISOString()).toBe("2026-09-01T03:00:00.000Z"); // ainda 30/09 em Brasília
    expect(inicioDoMesBrasilia(new Date("2026-10-01T03:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

describe("limites", () => {
  it("padrões e env", () => {
    expect(limitesOcr({})).toEqual({ max_paginas: 300, max_bytes: 25 * 1024 * 1024 });
    expect(limitesOcr({ GED_OCR_MAX_PAGINAS: "10", GED_OCR_MAX_MB: "1" })).toEqual({ max_paginas: 10, max_bytes: 1024 * 1024 });
  });
  it("recusa arquivo grande ou com muitas páginas", () => {
    const l = { max_paginas: 10, max_bytes: 1000 };
    expect(erroDeLimites({ paginas: 5, tamanho: 500 }, l)).toBeNull();
    expect(erroDeLimites({ paginas: 11, tamanho: 500 }, l)).toMatch(/10 páginas/);
    expect(erroDeLimites({ paginas: 1, tamanho: 2_000_000 }, l)).toMatch(/limite/);
  });
});

describe("mapeamento de status", () => {
  it("rótulos de UI", () => {
    expect(apresentacaoOcr("PENDENTE").rotulo).toBe("OCR pendente");
    expect(apresentacaoOcr("PROCESSANDO").rotulo).toBe("OCR processando");
    expect(apresentacaoOcr("CONCLUIDO").rotulo).toBe("OCR concluído");
    expect(apresentacaoOcr("OCR_INDISPONIVEL").rotulo).toBe("OCR indisponível");
    expect(apresentacaoOcr("COTA_EXCEDIDA").rotulo).toBe("OCR: cota excedida");
  });
  it("saída do processo → status", () => {
    expect(statusDaSaida(classificarSaidaOcr({ codigo: 0 })).status).toBe("CONCLUIDO");
    expect(statusDaSaida(classificarSaidaOcr({ codigo: null, erroSpawn: "ENOENT spawn ocrmypdf" })).status).toBe("OCR_INDISPONIVEL");
    expect(statusDaSaida(classificarSaidaOcr({ codigo: 127 })).status).toBe("OCR_INDISPONIVEL");
    expect(statusDaSaida(classificarSaidaOcr({ codigo: null, tempoEsgotado: true }))).toEqual({ status: "ERRO", mensagem: "Tempo limite do OCR excedido." });
    expect(statusDaSaida(classificarSaidaOcr({ codigo: 2, stderr: "entrada inválida" })).status).toBe("ERRO");
  });
  it("reprocessar: só ERRO/INDISPONIVEL/COTA ou scan legado; só ADMIN/GESTOR", () => {
    const v = { origem: "UPLOAD" as const, selada: false, texto_status: "SEM_TEXTO" };
    expect(ocrReprocessavel({ ...v, ocr_status: "ERRO" }, "PUBLICADO")).toBe(true);
    expect(ocrReprocessavel({ ...v, ocr_status: "COTA_EXCEDIDA" }, "PUBLICADO")).toBe(true);
    expect(ocrReprocessavel({ ...v, ocr_status: "OCR_INDISPONIVEL" }, "PUBLICADO")).toBe(true);
    expect(ocrReprocessavel({ ...v, ocr_status: null }, "PUBLICADO")).toBe(true);
    expect(ocrReprocessavel({ ...v, ocr_status: null, texto_status: "EXTRAIDO" }, "PUBLICADO")).toBe(false);
    for (const s of ["PENDENTE", "PROCESSANDO", "CONCLUIDO"] as const) expect(ocrReprocessavel({ ...v, ocr_status: s }, "PUBLICADO")).toBe(false);
    expect(ocrReprocessavel({ ...v, ocr_status: "ERRO" }, "ASSINADO")).toBe(false);
    expect(ocrReprocessavel({ ...v, ocr_status: "ERRO", selada: true }, "PUBLICADO")).toBe(false);
    expect(ocrReprocessavel({ ...v, ocr_status: "ERRO", origem: "OCR" }, "PUBLICADO")).toBe(false);
    expect(podeReprocessarOcrPapel("GED_ADMIN")).toBe(true);
    expect(podeReprocessarOcrPapel("GED_GESTOR")).toBe(true);
    for (const p of ["GED_USUARIO", "GED_LEITOR", "GED_AUDITOR"]) expect(podeReprocessarOcrPapel(p)).toBe(false);
  });
});

describe("ocrmypdf (spawn mockado)", () => {
  it("argumentos: -l por --skip-text --jobs 2, sem shell", () => {
    const a = argumentosOcr({ entrada: "/t/in.pdf", saida: "/t/out.pdf" });
    expect(a.slice(0, 5)).toEqual(["-l", "por", "--skip-text", "--jobs", "2"]);
    expect(a.slice(-2)).toEqual(["/t/in.pdf", "/t/out.pdf"]);
    expect(argumentosOcr({ entrada: "a.img", saida: "b.pdf", imagem: true })).toContain("--image-dpi");
  });
  it("binário configurável por GED_OCR_BIN", async () => {
    expect(binarioOcr({})).toBe("ocrmypdf");
    expect(binarioOcr({ GED_OCR_BIN: "/opt/ocr/ocrmypdf" })).toBe("/opt/ocr/ocrmypdf");
    vi.stubEnv("GED_OCR_BIN", "/opt/ocr/ocrmypdf");
    estado.cenario = { codigo: 0, saida: Buffer.from("%PDF-ocr") };
    const r = await executarOcr(Buffer.from("%PDF-scan"), PDF, { timeoutMs: 5000 });
    expect(r.saida.tipo).toBe("OK");
    expect(r.arquivo?.toString()).toBe("%PDF-ocr");
    expect(estado.chamadas[0].bin).toBe("/opt/ocr/ocrmypdf");
    expect(estado.chamadas[0].args).toEqual(expect.arrayContaining(["-l", "por", "--skip-text", "--jobs", "2"]));
    expect(estado.chamadas[0].env?.OMP_THREAD_LIMIT).toBe("1");
  });
  it("binário ausente → INDISPONIVEL (não lança)", async () => {
    estado.cenario = { erroSpawn: "spawn ocrmypdf ENOENT" };
    const r = await executarOcr(Buffer.from("%PDF-scan"), PDF, { timeoutMs: 5000 });
    expect(r.saida.tipo).toBe("INDISPONIVEL");
    expect(r.arquivo).toBeNull();
    expect(await ocrDisponivel({ forcar: true })).toBe(false);
  });
  it("disponibilidade usa --version e fica em cache", async () => {
    estado.cenario = { codigo: 0 };
    expect(await ocrDisponivel({ forcar: true })).toBe(true);
    expect(await ocrDisponivel()).toBe(true);
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0].args).toEqual(["--version"]);
  });
  it("código de saída ≠ 0 → FALHA com detalhe curto", async () => {
    estado.cenario = { codigo: 2 };
    const r = await executarOcr(Buffer.from("x"), PDF, { timeoutMs: 5000 });
    expect(r.saida).toMatchObject({ tipo: "FALHA", detalhe: expect.stringContaining("simulado") });
  });
  it("saída vazia/ausente com código 0 → FALHA", async () => {
    estado.cenario = { codigo: 0, saida: null };
    expect((await executarOcr(Buffer.from("x"), PDF, { timeoutMs: 5000 })).saida.tipo).toBe("FALHA");
  });
  it("timeout mata o processo", async () => {
    estado.cenario = { travar: true };
    const r = await executarOcr(Buffer.from("x"), PDF, { timeoutMs: 30 });
    expect(r.saida.tipo).toBe("TEMPO_ESGOTADO");
    expect(estado.mortes).toContain("SIGKILL");
  });
});
