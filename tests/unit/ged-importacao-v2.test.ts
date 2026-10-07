import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { chaveDiretorio, indicePastasPorDiretorio, MOTIVO_ZIP_DUPLICADO, nomeBaseZip, normalizarCaminho, unirPastasRepetidas, zipDuplicaPastaIrma } from "@/lib/ged/importacao/caminhos";
import { comRetentativa, ErroEnvio, executarEmFila, exigirOk, fatiarEmPartes, montarPlanoPasta, novoControle } from "@/lib/ged/importacao/cliente";
import { LIMITES_PADRAO, MAX_ZIP_SIMPLES, TAMANHO_PARTE_ZIP } from "@/lib/ged/importacao/limites";
import { ErroZip, extrairEntrada, extrairEntradaDisco, extrairEntradaParaArquivo, lerDiretorioZip, lerDiretorioZipDisco, planejarZip, ZipDisco } from "@/lib/ged/importacao/zip";

const tmp = mkdtempSync(path.join(os.tmpdir(), "ged-imp-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type E = { nome: string; dados?: Buffer; deflate?: boolean; dir?: boolean };
/** ZIP comum (32 bits) ou ZIP64 (tamanhos/deslocamentos em extra 0x0001, EOCD64 + localizador). */
function montarZip(entradas: E[], zip64 = false): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let off = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, "utf8");
    const dados = e.dados ?? Buffer.alloc(0);
    const comp = e.deflate ? deflateRawSync(dados) : dados;
    const crc = crc32(dados);
    const metodo = e.deflate ? 8 : 0;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(zip64 ? 45 : 20, 4); l.writeUInt16LE(0x800, 6); l.writeUInt16LE(metodo, 8);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(dados.length, 22); l.writeUInt16LE(nome.length, 26);
    locais.push(l, nome, comp);
    const extra = Buffer.alloc(zip64 ? 28 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(dados.length), 4); extra.writeBigUInt64LE(BigInt(comp.length), 12); extra.writeBigUInt64LE(BigInt(off), 20);
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(zip64 ? 45 : 20, 4); c.writeUInt16LE(zip64 ? 45 : 20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(metodo, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(zip64 ? 0xffffffff : comp.length, 20); c.writeUInt32LE(zip64 ? 0xffffffff : dados.length, 24);
    c.writeUInt16LE(nome.length, 28); c.writeUInt16LE(extra.length, 30);
    c.writeUInt32LE(zip64 ? 0xffffffff : off, 42);
    centrais.push(c, nome, extra);
    off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrais);
  const partes = [...locais, cd];
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  if (zip64) {
    const r = Buffer.alloc(56);
    r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(BigInt(44), 4); r.writeUInt16LE(45, 12); r.writeUInt16LE(45, 14);
    r.writeBigUInt64LE(BigInt(entradas.length), 24); r.writeBigUInt64LE(BigInt(entradas.length), 32); r.writeBigUInt64LE(BigInt(cd.length), 40); r.writeBigUInt64LE(BigInt(off), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(off + cd.length), 8); loc.writeUInt32LE(1, 16);
    partes.push(r, loc);
    eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10); eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16);
  } else {
    eocd.writeUInt16LE(entradas.length, 8); eocd.writeUInt16LE(entradas.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  }
  return Buffer.concat([...partes, eocd]);
}
const PDF = (t = "x") => Buffer.from(`%PDF-1.4\n${t}\n%%EOF\n`);
const noDisco = (nome: string, b: Buffer) => {
  const p = path.join(tmp, nome);
  writeFileSync(p, b);
  return p;
};

describe("importação v2 – ZIP em disco e ZIP64", () => {
  const entradas: E[] = [{ nome: "A/um.pdf", dados: PDF("um") }, { nome: "A/B/dois.pdf", dados: Buffer.concat([PDF("dois"), Buffer.alloc(4000, "a")]), deflate: true }];

  it("lê o diretório central e extrai a partir do ARQUIVO (sem carregar o ZIP) com o mesmo resultado do Buffer", async () => {
    const buf = montarZip(entradas);
    const z = await ZipDisco.abrir(noDisco("normal.zip", buf));
    try {
      const doDisco = await lerDiretorioZipDisco(z);
      const daMemoria = lerDiretorioZip(buf);
      expect(doDisco).toEqual(daMemoria);
      for (const e of doDisco) expect((await extrairEntradaDisco(z, e)).equals(extrairEntrada(buf, e))).toBe(true);
    } finally {
      await z.fechar();
    }
  });

  it("ZIP64 (EOCD64 + extra 0x0001) é lido da memória e do disco", async () => {
    const buf = montarZip(entradas, true);
    const mem = lerDiretorioZip(buf);
    expect(mem.map((e) => e.nome_bruto)).toEqual(["A/um.pdf", "A/B/dois.pdf"]);
    expect(mem[1].tamanho).toBe(entradas[1].dados!.length);
    expect(extrairEntrada(buf, mem[1]).equals(entradas[1].dados!)).toBe(true);
    const z = await ZipDisco.abrir(noDisco("z64.zip", buf));
    try {
      const disco = await lerDiretorioZipDisco(z);
      expect(disco).toEqual(mem);
      expect((await extrairEntradaDisco(z, disco[0])).equals(entradas[0].dados!)).toBe(true);
    } finally {
      await z.fechar();
    }
  });

  it("ZIP64 sem o registro/localizador é recusado; contagem de entradas acima do limite também", async () => {
    const buf = Buffer.from(montarZip(entradas, true));
    buf.fill(0, buf.length - 22 - 20, buf.length - 22); // apaga o localizador ZIP64
    expect(() => lerDiretorioZip(buf)).toThrow(/ZIP64/);
    const z = await ZipDisco.abrir(noDisco("z64-sem-loc.zip", buf));
    await expect(lerDiretorioZipDisco(z)).rejects.toThrow(/ZIP64/);
    await z.fechar();
    const muitos = montarZip(Array.from({ length: 11 }, (_, i) => ({ nome: `d${i}/`, dir: true })));
    const z2 = await ZipDisco.abrir(noDisco("muitos.zip", muitos));
    await expect(lerDiretorioZipDisco(z2, { ...LIMITES_PADRAO, maxEntradas: 10 })).rejects.toThrow(/itens demais/);
    await z2.fechar();
  });

  it("extração em fluxo para arquivo: confere CRC, tamanho declarado e teto (zip-bomb)", async () => {
    const conteudo = Buffer.concat([PDF("grande"), Buffer.alloc(200_000, "z")]);
    const buf = montarZip([{ nome: "g.bin", dados: conteudo, deflate: true }, { nome: "s.bin", dados: conteudo }]);
    const z = await ZipDisco.abrir(noDisco("fluxo.zip", buf));
    try {
      const [g, s] = await lerDiretorioZipDisco(z);
      const d1 = path.join(tmp, "g.out");
      await extrairEntradaParaArquivo(z, g, d1, 10 * 1048576);
      expect(readFileSync(d1).equals(conteudo)).toBe(true);
      const d2 = path.join(tmp, "s.out");
      await extrairEntradaParaArquivo(z, s, d2, 10 * 1048576);
      expect(readFileSync(d2).equals(conteudo)).toBe(true);
      await expect(extrairEntradaParaArquivo(z, g, path.join(tmp, "x1"), 1000)).rejects.toThrow(/excede o limite/);
      await expect(extrairEntradaParaArquivo(z, { ...g, crc: g.crc ^ 1 }, path.join(tmp, "x2"), 10 * 1048576)).rejects.toThrow(/CRC/);
      await expect(extrairEntradaParaArquivo(z, { ...g, tamanho: 100 }, path.join(tmp, "x3"), 10 * 1048576)).rejects.toThrow(ErroZip);
      await expect(extrairEntradaParaArquivo(z, { ...g, tamanho: g.tamanho + 5 }, path.join(tmp, "x4"), 10 * 1048576)).rejects.toThrow(/diverge/);
    } finally {
      await z.fechar();
    }
  });
});

describe("importação v2 – ZIP aninhado", () => {
  const pl = (e: E[], nivel = 0, l = LIMITES_PADRAO) => planejarZip(lerDiretorioZip(montarZip(e), l), l, { nivel });
  const zipInterno = montarZip([{ nome: "x.pdf", dados: PDF("i") }]);

  it("ZIP ao lado de pasta de mesmo nome (cópia da pasta) é IGNORADO com nota; sem pasta irmã é expandido como pasta", () => {
    const p = pl([
      { nome: "CONTABILIDADE-AGOSTO-2026/Processos de pagamento/PP-1.pdf", dados: PDF("1") },
      { nome: "CONTABILIDADE-AGOSTO-2026/Processos de pagamento.zip", dados: zipInterno },
      { nome: "CONTABILIDADE-AGOSTO-2026/Outro lote.zip", dados: zipInterno },
    ]);
    const por = Object.fromEntries(p.itens.map((i) => [i.nome, i]));
    expect(por["Processos de pagamento.zip"].previo).toEqual({ status: "IGNORADO", motivo: MOTIVO_ZIP_DUPLICADO });
    expect(por["Processos de pagamento.zip"].aninhado).toBeFalsy();
    expect(por["Outro lote.zip"].previo).toBeUndefined();
    expect(por["Outro lote.zip"].aninhado).toBe(true);
    expect(por["PP-1.pdf"].aninhado).toBeFalsy();
  });

  it("a pasta irmã é conferida sem diferenciar maiúsculas e só no MESMO diretório", () => {
    const p = pl([
      { nome: "a/RELATORIOS/r.pdf", dados: PDF("r") },
      { nome: "a/relatorios.zip", dados: zipInterno },
      { nome: "b/relatorios.zip", dados: zipInterno }, // pasta "relatorios" existe em a/, não em b/
      { nome: "relatorios.zip", dados: zipInterno }, // idem na raiz
    ]);
    const por = Object.fromEntries(p.itens.map((i) => [i.caminho, i]));
    expect(por["a/relatorios.zip"].previo?.motivo).toBe(MOTIVO_ZIP_DUPLICADO);
    expect(por["b/relatorios.zip"].aninhado).toBe(true);
    expect(por["relatorios.zip"].aninhado).toBe(true);
  });

  it("entrada de DIRETÓRIO vazia também conta como pasta irmã", () => {
    const p = pl([{ nome: "x/Dados/", dir: true }, { nome: "x/Dados.zip", dados: zipInterno }, { nome: "x/a.pdf", dados: PDF() }]);
    expect(p.itens.find((i) => i.nome === "Dados.zip")?.previo?.motivo).toBe(MOTIVO_ZIP_DUPLICADO);
  });

  it("profundidade de aninhamento: acima do limite vira erro do item; nível 0 e 1 expandem", () => {
    const e: E[] = [{ nome: "p/interno.zip", dados: zipInterno }];
    expect(pl(e, 0).itens[0].aninhado).toBe(true);
    expect(pl(e, 1).itens[0].aninhado).toBe(true);
    expect(pl(e, 2).itens[0].previo).toMatchObject({ status: "ERRO", motivo: expect.stringMatching(/além do limite/) });
  });

  it("ZIP aninhado acima do limite de tamanho vira erro; o conteúdo dele não entra na soma declarada do pai", () => {
    const l = { ...LIMITES_PADRAO, maxZipAninhadoBytes: 50 };
    expect(pl([{ nome: "z.zip", dados: zipInterno }], 0, l).itens[0].previo?.status).toBe("ERRO");
    const grande = montarZip([{ nome: "g.pdf", dados: Buffer.concat([PDF(), Buffer.alloc(900, "a")]) }]);
    const p = pl([{ nome: "z.zip", dados: grande }], 0, { ...LIMITES_PADRAO, maxTotalDescompactado: 100 });
    expect(p.itens[0].aninhado).toBe(true);
  });

  it("outros formatos continuam ignorados e .zip não é tratado como extensão proibida", () => {
    const p = pl([{ nome: "a/b.xlsx", dados: Buffer.from("x") }, { nome: "a/c.zip", dados: zipInterno }]);
    expect(p.itens.find((i) => i.nome === "b.xlsx")?.previo?.status).toBe("IGNORADO");
    expect(p.itens.find((i) => i.nome === "c.zip")?.previo).toBeUndefined();
  });
});

describe("importação v2 – caminhos e união de pastas", () => {
  it("unirPastasRepetidas colapsa A/A → A (e A/A/A), sem diferenciar maiúsculas, e só pastas consecutivas", () => {
    expect(unirPastasRepetidas(["A", "A"])).toEqual(["A"]);
    expect(unirPastasRepetidas(["A", "A", "A", "B"])).toEqual(["A", "B"]);
    expect(unirPastasRepetidas(["Processos", "processos", "x"])).toEqual(["Processos", "x"]);
    expect(unirPastasRepetidas(["A", "B", "A"])).toEqual(["A", "B", "A"]);
    expect(unirPastasRepetidas([])).toEqual([]);
  });
  it("por padrão (sem a opção) a estrutura NÃO é alterada: o plano guarda A/A como veio", () => {
    const n = normalizarCaminho("Pagamentos/Pagamentos/PP-1.pdf");
    expect(n.ok && n.segmentos).toEqual(["Pagamentos", "Pagamentos", "PP-1.pdf"]);
  });
  it("normalizarCaminho: NFC, barra invertida, zip-slip, unidade, controle", () => {
    expect(normalizarCaminho("Licita\u0063\u0327a\u0303o\\2026\\a.pdf")).toEqual({ ok: true, segmentos: ["Licitação", "2026", "a.pdf"] });
    expect(normalizarCaminho("../x.pdf").ok).toBe(false);
    expect(normalizarCaminho("a/../../x.pdf").ok).toBe(false);
    expect(normalizarCaminho("C:\\x.pdf").ok).toBe(false);
    expect(normalizarCaminho("/etc/passwd").ok).toBe(false);
    expect(normalizarCaminho("a\u0000b").ok).toBe(false);
    expect(normalizarCaminho("a/ /b.pdf").ok).toBe(false);
  });
  it("nome-base do ZIP e regra do irmão", () => {
    expect(nomeBaseZip("Processos de pagamento orçamentário, exceto folha.zip")).toBe("Processos de pagamento orçamentário, exceto folha");
    expect(zipDuplicaPastaIrma("A.ZIP", new Set(["a"]))).toBe(true);
    expect(zipDuplicaPastaIrma("A.zip", new Set(["b"]))).toBe(false);
    const idx = indicePastasPorDiretorio([["R", "S", "f.pdf"], ["R", "T", "g.pdf"], ["h.pdf"]]);
    expect([...idx.get("")!]).toEqual(["r"]);
    expect([...idx.get(chaveDiretorio(["R"]))!].sort()).toEqual(["s", "t"]);
  });
});

describe("importação v2 – plano da pasta no navegador", () => {
  const f = (caminho: string, tamanho = 1000) => ({ caminho, tamanho });
  it("cenário real: ZIP ao lado da pasta não é enviado; lixo e formatos fora de PDF viram contagem; resumo coerente", () => {
    const base = "LICITAÇÃO-AGOSTO-2026/CONTABILIDADE-AGOSTO-2026";
    const p = montarPlanoPasta([
      f(`${base}/Processos de pagamento orçamentário, exceto folha/Processos de pagamento orçamentário, exceto folha/PP-N-1202.pdf`, 2_000_000),
      f(`${base}/Processos de pagamento orçamentário, exceto folha/Processos de pagamento orçamentário, exceto folha/PP-N-1203.pdf`, 3_000_000),
      f(`${base}/Processos de pagamento orçamentário, exceto folha.zip`, 270_000_000),
      f(`${base}.zip`, 7_800_000),
      f(`${base}/Thumbs.db`),
      f(`${base}/.DS_Store`),
      f(`${base}/planilha.xlsx`),
      f(`${base}/planilha2.xlsx`),
      f(`${base}/nota.docx`),
      f(`${base}/enorme.pdf`, 30_000_000),
      f(`${base}/avulso.zip`, 1_000_000),
    ]);
    expect(p.enviar.map((a) => a.caminho)).toEqual([
      `${base}/Processos de pagamento orçamentário, exceto folha/Processos de pagamento orçamentário, exceto folha/PP-N-1202.pdf`,
      `${base}/Processos de pagamento orçamentário, exceto folha/Processos de pagamento orçamentário, exceto folha/PP-N-1203.pdf`,
      `${base}/avulso.zip`,
    ]);
    expect(p.resumo).toMatchObject({ pdfs: 2, pdfsBytes: 5_000_000, zipsAninhados: 1, zipsDuplicados: 2, grandesDemais: 1, ignoradosPorTipo: { ".xlsx": 2, ".docx": 1 }, bytesAEnviar: 6_000_000 });
    expect(p.ocultos).toBe(2);
    expect(p.raizes).toEqual(["LICITAÇÃO-AGOSTO-2026"]);
    expect(p.ignorados.filter((i) => i.motivo === MOTIVO_ZIP_DUPLICADO).map((i) => i.caminho)).toHaveLength(2);
    expect(p.bloqueio).toBeNull();
  });
  it("bloqueia quando não há PDF, ou passa dos limites", () => {
    expect(montarPlanoPasta([f("a/x.xlsx")]).bloqueio).toMatch(/Nenhum PDF/);
    const muitos = Array.from({ length: 6 }, (_, i) => f(`a/${i}.pdf`));
    expect(montarPlanoPasta(muitos, { ...LIMITES_PADRAO, maxArquivos: 5 }).bloqueio).toMatch(/limite é 5/);
    expect(montarPlanoPasta([f("a/1.pdf", 600), f("b/2.pdf", 600)], { ...LIMITES_PADRAO, maxTotalDescompactado: 1000 }).bloqueio).toMatch(/GB/);
  });
  it("zip-slip no caminho vira ignorado com motivo (nunca é enviado)", () => {
    const p = montarPlanoPasta([f("a/../../x.pdf"), f("a/ok.pdf")]);
    expect(p.enviar).toHaveLength(1);
    expect(p.ignorados[0].motivo).toMatch(/\.\./);
  });
});

describe("importação v2 – limites, partes, fila e retentativa", () => {
  it("limites novos: ZIP ~2 GB cabe em INTEGER, 20 000 arquivos, 6 GB descompactados, aninhamento 2", () => {
    expect(LIMITES_PADRAO.maxZipBytes).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(LIMITES_PADRAO.maxZipBytes).toBeGreaterThanOrEqual(1.9e9);
    expect(LIMITES_PADRAO.maxArquivos).toBe(20_000);
    expect(LIMITES_PADRAO.maxTotalDescompactado).toBe(6 * 1024 ** 3);
    expect(LIMITES_PADRAO.maxArquivoBytes).toBe(25 * 1024 * 1024);
    expect(LIMITES_PADRAO.maxAninhamento).toBe(2);
    expect(MAX_ZIP_SIMPLES).toBeLessThan(LIMITES_PADRAO.maxZipBytes);
  });
  it("fatiarEmPartes cobre o arquivo sem sobras (última parte com o resto)", () => {
    const t = 3 * TAMANHO_PARTE_ZIP + 123;
    const p = fatiarEmPartes(t);
    expect(p).toHaveLength(4);
    expect(p[0]).toEqual({ n: 1, inicio: 0, fim: TAMANHO_PARTE_ZIP });
    expect(p[3]).toEqual({ n: 4, inicio: 3 * TAMANHO_PARTE_ZIP, fim: t });
    expect(fatiarEmPartes(TAMANHO_PARTE_ZIP)).toHaveLength(1);
    expect(fatiarEmPartes(2_000_000_000)).toHaveLength(Math.ceil(2_000_000_000 / TAMANHO_PARTE_ZIP));
  });
  it("executarEmFila respeita a concorrência máxima, processa tudo e para no cancelamento", async () => {
    let ativos = 0;
    let maximo = 0;
    const feitos: number[] = [];
    await executarEmFila(Array.from({ length: 20 }, (_, i) => i), 4, async (i) => {
      ativos++;
      maximo = Math.max(maximo, ativos);
      await new Promise((r) => setTimeout(r, 5));
      feitos.push(i);
      ativos--;
    });
    expect(maximo).toBe(4);
    expect(feitos).toHaveLength(20);
    const c = novoControle();
    const parcial: number[] = [];
    await executarEmFila(Array.from({ length: 50 }, (_, i) => i), 2, async (i) => {
      parcial.push(i);
      if (i === 5) c.cancelado = true;
      await new Promise((r) => setTimeout(r, 1));
    }, c);
    expect(parcial.length).toBeLessThan(50);
  });
  it("pausa segura os itens novos até retomar", async () => {
    const c = novoControle();
    c.pausado = true;
    let n = 0;
    const fim = executarEmFila([1, 2, 3], 2, async () => void n++, c);
    await new Promise((r) => setTimeout(r, 400));
    expect(n).toBe(0);
    c.pausado = false;
    await fim;
    expect(n).toBe(3);
  });
  it("comRetentativa repete falhas de rede/5xx, desiste de 4xx e do limite de tentativas", async () => {
    let tentativas = 0;
    const r = await comRetentativa(async () => {
      if (++tentativas < 3) throw new ErroEnvio("rede", 0, true);
      return "ok";
    }, { baseMs: 1 });
    expect(r).toBe("ok");
    expect(tentativas).toBe(3);
    let t2 = 0;
    await expect(comRetentativa(async () => { t2++; throw new ErroEnvio("proibido", 403, false); }, { baseMs: 1 })).rejects.toThrow("proibido");
    expect(t2).toBe(1);
    let t3 = 0;
    await expect(comRetentativa(async () => { t3++; throw new ErroEnvio("sempre", 503, true); }, { baseMs: 1, tentativas: 4 })).rejects.toThrow("sempre");
    expect(t3).toBe(4);
  });
  it("exigirOk classifica respostas: 5xx/429/arquivo corrompido são retentáveis; 4xx não", () => {
    expect(exigirOk({ status: 201, corpo: { a: 1 } })).toEqual({ a: 1 });
    const cap = (status: number, corpo: unknown) => { try { exigirOk({ status, corpo }); } catch (e) { return e as ErroEnvio; } return null; };
    expect(cap(503, null)?.retentavel).toBe(true);
    expect(cap(429, null)?.retentavel).toBe(true);
    expect(cap(422, { code: "ARQUIVO_CORROMPIDO", message: "x" })?.retentavel).toBe(true);
    expect(cap(422, { code: "INVALIDO", message: "x" })?.retentavel).toBe(false);
    expect(cap(403, { message: "Acesso negado" })?.message).toBe("Acesso negado");
  });
});
