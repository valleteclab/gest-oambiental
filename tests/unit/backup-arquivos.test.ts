// Replicação de arquivos (lib/backup/arquivos.ts): partes puras, destino em diretório e restauração – sem banco.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chaveDestino, chaveOrigemDe, conferirCopia, destinoDiretorio, diferenca, filtrarPrefixo, inicioConsulta, jaReplicado, marcaDaObservacao,
  contagemDaObservacao, normalizarPrefixo, novaMarca, observacaoReplicacao, resolverDestino, restaurarArquivos, sha256, validarChave,
} from "../../lib/backup/arquivos";

const ORG = "11111111-1111-4111-8111-111111111111";
const CH = `ged/${ORG}/2026/22222222-2222-4222-8222-222222222222/v1-abcd1234.pdf`;

describe("chaves", () => {
  it("validarChave aceita chaves de storage e recusa caminho fora, URL e controle", () => {
    expect(validarChave(CH)).toBe(CH);
    expect(validarChave("LOR/anexos/abc/doc.pdf")).toBe("LOR/anexos/abc/doc.pdf");
    for (const ruim of ["", "/etc/passwd", "../x", "a/../b", "a\\b", "a//b", "http://x/y", "C:/x", "a\u0000b", "a".repeat(513)]) expect(() => validarChave(ruim), ruim).toThrow();
    expect(() => validarChave(undefined)).toThrow();
  });

  it("chaveDestino / chaveOrigemDe são inversas e respeitam o prefixo", () => {
    expect(chaveDestino(CH)).toBe(`arquivos/${CH}`);
    expect(chaveOrigemDe(`arquivos/${CH}`)).toBe(CH);
    expect(chaveOrigemDe(CH)).toBeNull();
    expect(chaveOrigemDe("arquivos/")).toBeNull();
    expect(chaveDestino("a/b", "/bkp/x//")).toBe("bkp/x/a/b");
    expect(normalizarPrefixo("")).toBe("");
    expect(normalizarPrefixo("/a/b/")).toBe("a/b/");
  });

  it("filtrarPrefixo (strings e objetos) – restaura só um cliente", () => {
    const outro = "ged/99999999-9999-4999-8999-999999999999/2026/x/v1-aaaaaaaa.pdf";
    expect(filtrarPrefixo([CH, outro, "LOR/a.pdf"], `ged/${ORG}/`)).toEqual([CH]);
    expect(filtrarPrefixo([{ chave: CH }, { chave: outro }], "ged/").length).toBe(2);
    expect(filtrarPrefixo([CH, outro], undefined)).toEqual([CH, outro]);
    expect(filtrarPrefixo([CH, outro], `ged/${ORG.slice(0, 8)}`)).toEqual([CH]);
  });
});

describe("diferenca (inventário × destino)", () => {
  const inv = (chave: string, tamanho: number | null = 10) => ({ chave, tamanho, sha256: null });
  it("faltando, tamanho diferente e sobrando (sobrando só informa)", () => {
    const d = diferenca([inv("a"), inv("b", 5), inv("c", null), inv("a")], [{ chave: "b", tamanho: 6 }, { chave: "c", tamanho: 99 }, { chave: "z", tamanho: 1 }]);
    expect(d.faltando.map((x) => x.chave)).toEqual(["a"]);
    expect(d.tamanhoDiferente.map((x) => x.chave)).toEqual(["b"]); // c não tem tamanho conhecido: não é "diferente"
    expect(d.sobrando).toEqual(["z"]);
  });
  it("tudo igual => nada a fazer", () => {
    const d = diferenca([inv("a", 1)], [{ chave: "a", tamanho: 1 }]);
    expect(d).toEqual({ faltando: [], tamanhoDiferente: [], sobrando: [] });
  });
});

describe("conferência de cópia", () => {
  const esp = { tamanho: 3, sha256: sha256(Buffer.from("abc")) };
  it("tamanho e sha256", () => {
    expect(conferirCopia(esp, { tamanho: 3, sha256: esp.sha256 }).ok).toBe(true);
    expect(conferirCopia(esp, { tamanho: 3, sha256: null }).ok).toBe(true); // destino sem hash: só tamanho
    expect(conferirCopia(esp, { tamanho: 4, sha256: esp.sha256 })).toMatchObject({ ok: false });
    expect(conferirCopia(esp, { tamanho: 3, sha256: "0".repeat(64) })).toMatchObject({ ok: false, motivo: "sha256 do destino diverge" });
    expect(conferirCopia(esp, null).ok).toBe(false);
  });
  it("jaReplicado exige sha256 conhecido no destino (senão recopia)", () => {
    expect(jaReplicado({ tamanho: 3, sha256: esp.sha256 }, esp)).toBe(true);
    expect(jaReplicado({ tamanho: 3, sha256: null }, esp)).toBe(false);
    expect(jaReplicado(null, esp)).toBe(false);
  });
});

describe("marca d'água", () => {
  it("round-trip pela observação", () => {
    const marca = new Date("2026-10-07T06:00:00.000Z");
    const obs = observacaoReplicacao({ modo: "INCREMENTAL", marca, copiados: 3, jaNoDestino: 2, bytes: 1234, erros: 0, divergencias: 1, duracaoMs: 1500, origem: "teste" });
    expect(marcaDaObservacao(obs)?.toISOString()).toBe(marca.toISOString());
    expect(contagemDaObservacao(obs, "copiados")).toBe(3);
    expect(contagemDaObservacao(obs, "divergencias")).toBe(1);
    expect(contagemDaObservacao(obs, "inexistente")).toBeNull();
    expect(marcaDaObservacao(observacaoReplicacao({ modo: "RECONCILIACAO", marca: null, copiados: 0, jaNoDestino: 0, bytes: 0, erros: 0, divergencias: 0, duracaoMs: 1, origem: "x" }))).toBeNull();
    expect(marcaDaObservacao(null)).toBeNull();
  });
  it("inicioConsulta aplica a margem; sem marca = época", () => {
    expect(inicioConsulta(new Date("2026-10-07T12:00:00Z"), 3600_000).toISOString()).toBe("2026-10-07T11:00:00.000Z");
    expect(inicioConsulta(null).getTime()).toBe(0);
  });
  it("novaMarca: erro mantém a anterior; truncado usa o último processado; ok usa o início", () => {
    const a = new Date("2026-10-01T00:00:00Z");
    const ini = new Date("2026-10-07T03:00:00Z");
    const ult = new Date("2026-10-05T10:00:00Z");
    expect(novaMarca({ anterior: a, inicio: ini, erros: 2, ultimoProcessado: ult, truncado: false })).toBe(a);
    expect(novaMarca({ anterior: null, inicio: ini, erros: 1, ultimoProcessado: ult, truncado: true })).toBeNull();
    expect(novaMarca({ anterior: a, inicio: ini, erros: 0, ultimoProcessado: ult, truncado: true })).toBe(ult);
    expect(novaMarca({ anterior: a, inicio: ini, erros: 0, ultimoProcessado: ult, truncado: false })).toBe(ini);
  });
});

describe("resolverDestino", () => {
  it("BACKUP_ARQUIVOS_DIR tem prioridade; sem bucket cai no storage local em backups/arquivos/", () => {
    expect(resolverDestino({ BACKUP_ARQUIVOS_DIR: "/tmp/x" }).foraDoProvedor).toBe(true);
    const fb = resolverDestino({ STORAGE_LOCAL_DIR: "/tmp/stor" });
    expect(fb.foraDoProvedor).toBe(false);
    expect(fb.descricao).toContain(path.join("/tmp/stor", "backups", "arquivos"));
    expect(fb.descricao).toContain("NÃO configurada");
  });
  it("com BACKUP_S3_* aponta para o bucket externo", () => {
    const d = resolverDestino({ BACKUP_S3_BUCKET: "dr", BACKUP_S3_ACCESS_KEY_ID: "k", BACKUP_S3_SECRET_ACCESS_KEY: "s", BACKUP_S3_ENDPOINT: "https://x.r2.cloudflarestorage.com" });
    expect(d.foraDoProvedor).toBe(true);
    expect(d.descricao).toBe("s3://dr/arquivos/ (fora do provedor)");
  });
});

describe("destino em diretório + restauração", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "bkp-arq-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("put/head/get/listar com sidecar sha256; listar não inclui sidecars; chave fora do diretório é recusada", async () => {
    const d = destinoDiretorio(path.join(tmp, "dest"));
    const dados = Buffer.from("%PDF-1.4 conteudo");
    await d.put(CH, dados, sha256(dados));
    expect(await d.head(CH)).toEqual({ tamanho: dados.length, sha256: sha256(dados) });
    expect(await d.head("ged/nao/existe.pdf")).toBeNull();
    expect((await d.get(CH)).equals(dados)).toBe(true);
    expect(await d.listar()).toEqual([{ chave: CH, tamanho: dados.length }]);
    expect(await d.listar(`ged/${ORG}/`)).toHaveLength(1);
    expect(await d.listar("ged/outro/")).toHaveLength(0);
    await expect(d.put("../fora.pdf", dados, "x")).rejects.toThrow();
    // arquivo no destino com o conteúdo corrompido: o tamanho/hash do sidecar já não conferem
    await writeFile(path.join(tmp, "dest", "arquivos", CH), Buffer.from("corrompido!!"));
    const h = await d.head(CH);
    expect(conferirCopia({ tamanho: dados.length, sha256: sha256(dados) }, h).ok).toBe(false);
  });

  it("restaurarArquivos: filtra por prefixo, preserva existentes, confere hash e simula", async () => {
    const origem = destinoDiretorio(path.join(tmp, "dest"));
    const outroOrg = "ged/99999999-9999-4999-8999-999999999999/2026/33333333-3333-4333-8333-333333333333/v1-bbbbbbbb.pdf";
    const a = Buffer.from("A-pdf");
    const b = Buffer.from("B-pdf");
    await origem.put(CH, a, sha256(a));
    await origem.put(outroOrg, b, sha256(b));
    const gravados = new Map<string, Buffer>();
    const destino = { gravar: async (k: string, d: Buffer) => void gravados.set(k, d), existe: async (k: string) => gravados.has(k) };

    const sim = await restaurarArquivos({ origem, destino, prefixo: `ged/${ORG}/`, simular: true });
    expect(sim).toMatchObject({ total: 1, restaurados: 1, simulado: true });
    expect(gravados.size).toBe(0);

    const r1 = await restaurarArquivos({ origem, destino, prefixo: `ged/${ORG}/` });
    expect(r1).toMatchObject({ total: 1, restaurados: 1, jaExistiam: 0, bytes: a.length, erros: [] });
    expect([...gravados.keys()]).toEqual([CH]); // o outro cliente NÃO foi restaurado

    const r2 = await restaurarArquivos({ origem, destino, prefixo: `ged/${ORG}/` });
    expect(r2).toMatchObject({ restaurados: 0, jaExistiam: 1 });

    // arquivo corrompido no destino de backup: é recusado (não grava lixo)
    await writeFile(path.join(tmp, "dest", "arquivos", outroOrg), Buffer.from("lixo"));
    const r3 = await restaurarArquivos({ origem, destino });
    expect(r3.erros).toHaveLength(1);
    expect(r3.erros[0]).toContain(outroOrg);
    expect(gravados.has(outroOrg)).toBe(false);
  });

  it("listar tolera diretório inexistente", async () => {
    const d = destinoDiretorio(path.join(tmp, "nada"));
    expect(await d.listar()).toEqual([]);
    await mkdir(path.join(tmp, "nada"), { recursive: true });
    expect(await d.listar()).toEqual([]);
    expect((await readFile(path.join(tmp, "dest-inexistente.txt")).catch(() => null))).toBeNull();
  });
});
