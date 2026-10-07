import { deflateRawSync, crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LIMITES_PADRAO } from "@/lib/ged/importacao/limites";
import { tituloDoArquivo } from "@/lib/ged/importacao/nomes";
import { decodificarCp850, ErroZip, extrairEntrada, lerDiretorioZip, normalizarCaminho, planejarZip, segmentoIgnorado } from "@/lib/ged/importacao/zip";
import { podeImportarGed } from "@/lib/ged/papeis";

// Gerador mínimo de ZIP (para controlar nome bruto, flags e tamanhos declarados – coisas que bibliotecas normalizam).
type E = { nome: string | Buffer; dados?: Buffer; deflate?: boolean; utf8?: boolean; usizeDeclarado?: number; csizeDeclarado?: number; dir?: boolean; unixModo?: number; cifrada?: boolean };
function zip(entradas: E[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let off = 0;
  for (const e of entradas) {
    const nome = Buffer.isBuffer(e.nome) ? e.nome : Buffer.from(e.nome, "utf8");
    const dados = e.dados ?? Buffer.alloc(0);
    const comp = e.deflate ? deflateRawSync(dados) : dados;
    const flags = (e.utf8 === false ? 0 : 0x800) | (e.cifrada ? 1 : 0);
    const crc = crc32(dados);
    const usize = e.usizeDeclarado ?? dados.length;
    const csize = e.csizeDeclarado ?? comp.length;
    const metodo = e.deflate ? 8 : 0;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(flags, 6); l.writeUInt16LE(metodo, 8);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(csize, 18); l.writeUInt32LE(usize, 22); l.writeUInt16LE(nome.length, 26);
    locais.push(l, nome, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(e.unixModo !== undefined ? (3 << 8) | 20 : 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(metodo, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(csize, 20); c.writeUInt32LE(usize, 24); c.writeUInt16LE(nome.length, 28);
    if (e.unixModo !== undefined) c.writeUInt32LE((e.unixModo << 16) >>> 0, 38);
    c.writeUInt32LE(off, 42);
    centrais.push(c, nome);
    off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, cd, fim]);
}
const PDF = Buffer.from("%PDF-1.4\nconteudo\n%%EOF\n");
const plano = (b: Buffer, l = LIMITES_PADRAO) => planejarZip(lerDiretorioZip(b, l), l);

describe("importação ZIP – leitura", () => {
  it("lê stored e deflate e devolve os bytes originais", () => {
    const grande = Buffer.concat([PDF, Buffer.alloc(5000, "a")]);
    const z = zip([{ nome: "a/um.pdf", dados: PDF }, { nome: "a/dois.pdf", dados: grande, deflate: true }]);
    const p = plano(z);
    expect(p.itens.map((i) => i.caminho)).toEqual(["a/dois.pdf", "a/um.pdf"]);
    expect(extrairEntrada(z, p.itens[0].entrada).equals(grande)).toBe(true);
    expect(extrairEntrada(z, p.itens[1].entrada).equals(PDF)).toBe(true);
    expect(p.pastas).toEqual([["a"]]);
  });

  it("rejeita arquivo que não é ZIP, vazio e ZIP truncado", () => {
    expect(() => lerDiretorioZip(Buffer.from("isto não é um zip de verdade, claro que não"))).toThrow(ErroZip);
    expect(() => lerDiretorioZip(Buffer.alloc(5))).toThrow(ErroZip);
    const z = zip([{ nome: "a.pdf", dados: PDF }]);
    expect(() => lerDiretorioZip(z.subarray(0, z.length - 10))).toThrow(ErroZip);
  });

  it("estrutura de pastas vira lista de pastas (ancestrais incluídos, sem repetir, sem diferenciar maiúsculas)", () => {
    const p = plano(zip([
      { nome: "Cliente A/Licitação/edital.pdf", dados: PDF },
      { nome: "Cliente A/Pagamentos/2026/nf.pdf", dados: PDF },
      { nome: "cliente a/Pagamentos/outro.pdf", dados: PDF },
      { nome: "Cliente A/", dir: true },
    ]));
    expect(p.pastas.map((x) => x.join("/")).sort()).toEqual(["Cliente A", "Cliente A/Licitação", "Cliente A/Pagamentos", "Cliente A/Pagamentos/2026"]);
  });
});

describe("importação ZIP – nomes e encoding", () => {
  it("UTF-8 com flag, UTF-8 sem flag e CP850 (Windows pt-BR antigo)", () => {
    const utf8 = zip([{ nome: "Licitação/Relatório.pdf", dados: PDF }]);
    expect(plano(utf8).itens[0].caminho).toBe("Licitação/Relatório.pdf");
    const semFlag = zip([{ nome: Buffer.from("Licitação/Relatório.pdf", "utf8"), utf8: false, dados: PDF }]);
    expect(plano(semFlag).itens[0].caminho).toBe("Licitação/Relatório.pdf");
    // "Licitação" em CP850: ç=0x87, ã=0xC6
    const cp850 = zip([{ nome: Buffer.from([0x4c, 0x69, 0x63, 0x69, 0x74, 0x61, 0x87, 0xc6, 0x6f, 0x2f, 0x61, 0x2e, 0x70, 0x64, 0x66]), utf8: false, dados: PDF }]);
    expect(plano(cp850).itens[0].caminho).toBe("Licitação/a.pdf");
    expect(decodificarCp850(Buffer.from([0x82, 0xa0, 0xa2]))).toBe("éáó");
  });
  it("normaliza NFD (macOS) para NFC", () => {
    const nfd = "Relatório".normalize("NFD");
    expect(plano(zip([{ nome: `${nfd}.pdf`, dados: PDF }])).itens[0].caminho).toBe("Relatório.pdf");
  });
  it("barra invertida (Windows) vira separador", () => {
    expect(plano(zip([{ nome: "Pasta\\Sub\\x.pdf", dados: PDF }])).itens[0].caminho).toBe("Pasta/Sub/x.pdf");
  });
  it("título do documento a partir do nome do arquivo", () => {
    expect(tituloDoArquivo("Nota_Fiscal__123.PDF")).toBe("Nota Fiscal 123");
    expect(tituloDoArquivo("a.pdf")).toBe("Documento a");
    expect(tituloDoArquivo("x".repeat(400) + ".pdf").length).toBeLessThanOrEqual(250);
  });
});

describe("importação ZIP – zip-slip", () => {
  it.each(["../fora.pdf", "a/../../fora.pdf", "/etc/passwd.pdf", "C:/Windows/x.pdf", "c:\\x.pdf", "..\\fora.pdf", "a/b/../../../c.pdf"])("recusa %s", (nome) => {
    const n = normalizarCaminho(nome);
    expect(n.ok).toBe(false);
    const p = plano(zip([{ nome, dados: PDF }]));
    expect(p.itens).toHaveLength(1);
    expect(p.itens[0].previo?.status).toBe("ERRO");
    expect(p.pastas).toEqual([]);
  });
  it("recusa caracteres de controle e NUL", () => {
    expect(normalizarCaminho("a\u0000b.pdf").ok).toBe(false);
    expect(normalizarCaminho("a\nb.pdf").ok).toBe(false);
  });
  it("segmentos '.' e vazios são descartados; espaços e pontos finais aparados", () => {
    const n = normalizarCaminho("./a//b. /c.pdf");
    expect(n).toEqual({ ok: true, segmentos: ["a", "b", "c.pdf"] });
  });
  it("nome de pasta longo é truncado em 120", () => {
    const n = normalizarCaminho(`${"p".repeat(300)}/x.pdf`);
    expect(n.ok && n.segmentos[0].length).toBe(120);
  });
});

describe("importação ZIP – lixo e extensões", () => {
  it("ignora __MACOSX, .DS_Store, Thumbs.db, desktop.ini, ~$ e itens ocultos (sem virar item)", () => {
    const p = plano(zip([
      { nome: "__MACOSX/pasta/._a.pdf", dados: PDF },
      { nome: "pasta/.DS_Store", dados: PDF },
      { nome: "pasta/Thumbs.db", dados: PDF },
      { nome: "pasta/desktop.ini", dados: PDF },
      { nome: "pasta/~$temp.pdf", dados: PDF },
      { nome: ".git/config.pdf", dados: PDF },
      { nome: "pasta/.oculto.pdf", dados: PDF },
      { nome: "pasta/real.pdf", dados: PDF },
    ]));
    expect(p.itens.map((i) => i.caminho)).toEqual(["pasta/real.pdf"]);
    expect(p.ocultos).toBe(7);
    expect(["__MACOSX", ".DS_Store", "Thumbs.db", "desktop.ini", "~$x", ".x", "normal"].map(segmentoIgnorado)).toEqual([true, true, true, true, true, true, false]);
  });
  it("extensões fora de PDF são ignoradas com motivo; PDF em maiúsculas passa", () => {
    const p = plano(zip([{ nome: "a.xlsx", dados: PDF }, { nome: "b.exe", dados: PDF }, { nome: "c.PDF", dados: PDF }, { nome: "semextensao", dados: PDF }]));
    const por = Object.fromEntries(p.itens.map((i) => [i.caminho, i.previo?.status ?? "OK"]));
    expect(por).toEqual({ "a.xlsx": "IGNORADO", "b.exe": "IGNORADO", "c.PDF": "OK", semextensao: "IGNORADO" });
  });
  it("link simbólico e arquivo com senha não são importados", () => {
    const p = plano(zip([{ nome: "atalho.pdf", dados: Buffer.from("/etc/passwd"), unixModo: 0xa1ff }, { nome: "secreto.pdf", dados: PDF, cifrada: true }]));
    const por = Object.fromEntries(p.itens.map((i) => [i.caminho, i.previo?.status]));
    expect(por).toEqual({ "atalho.pdf": "IGNORADO", "secreto.pdf": "ERRO" });
  });
});

describe("importação ZIP – zip-bomb e limites", () => {
  const pequenos = { ...LIMITES_PADRAO, maxArquivos: 3, maxEntradas: 10, maxPastas: 2, maxProfundidade: 2, maxTotalDescompactado: 1000, maxArquivoBytes: 500, maxRazaoCompressao: 10 };
  it("nº de arquivos acima do limite recusa o ZIP", () => {
    const z = zip(Array.from({ length: 4 }, (_, i) => ({ nome: `f${i}.pdf`, dados: PDF })));
    expect(() => plano(z, pequenos)).toThrow(/arquivos demais/);
  });
  it("nº de entradas (inclui pastas e lixo) acima do limite recusa antes de ler o diretório", () => {
    const z = zip(Array.from({ length: 11 }, (_, i) => ({ nome: `d${i}/`, dir: true })));
    expect(() => lerDiretorioZip(z, pequenos)).toThrow(/itens demais/);
  });
  it("nº de pastas acima do limite recusa", () => {
    const z = zip([{ nome: "a/x.pdf", dados: PDF }, { nome: "b/x.pdf", dados: PDF }, { nome: "c/x.pdf", dados: PDF }]);
    expect(() => plano(z, pequenos)).toThrow(/pastas demais/);
  });
  it("profundidade acima do limite marca o arquivo com erro (sem criar pastas)", () => {
    const p = plano(zip([{ nome: "a/b/c/d/x.pdf", dados: PDF }]), pequenos);
    expect(p.itens[0].previo).toMatchObject({ status: "ERRO" });
    expect(p.pastas).toEqual([]);
  });
  it("soma declarada acima do limite recusa; arquivo individual grande vira erro", () => {
    const grande = Buffer.concat([PDF, Buffer.alloc(400, "a")]);
    expect(() => plano(zip([{ nome: "a.pdf", dados: grande }, { nome: "b.pdf", dados: grande }, { nome: "c.pdf", dados: grande }]), pequenos)).toThrow(/descompactado excede/);
    const p = plano(zip([{ nome: "g.pdf", dados: Buffer.concat([PDF, Buffer.alloc(600, "a")]) }]), pequenos);
    expect(p.itens[0].previo?.status).toBe("ERRO");
  });
  it("razão de compressão suspeita (arquivo > 1 MiB) vira erro", () => {
    const dados = Buffer.concat([PDF, Buffer.alloc(2 * 1048576, 0)]);
    const p = plano(zip([{ nome: "bomba.pdf", dados, deflate: true }]), { ...LIMITES_PADRAO, maxRazaoCompressao: 50 });
    expect(p.itens[0].previo?.motivo).toMatch(/zip-bomb/);
  });
  it("tamanho DECLARADO menor que o real: a inflação é cortada (não estoura memória)", () => {
    const real = Buffer.concat([PDF, Buffer.alloc(100_000, "a")]);
    const z = zip([{ nome: "mente.pdf", dados: real, deflate: true, usizeDeclarado: 100 }]);
    const p = plano(z);
    expect(() => extrairEntrada(z, p.itens[0].entrada)).toThrow(/excede o declarado|diverge/);
  });
  it("tamanho declarado maior que o real, CRC errado e dados corrompidos são recusados", () => {
    const z1 = zip([{ nome: "a.pdf", dados: PDF, deflate: true, usizeDeclarado: PDF.length + 5 }]);
    expect(() => extrairEntrada(z1, plano(z1).itens[0].entrada)).toThrow(ErroZip);
    const z2 = zip([{ nome: "a.pdf", dados: PDF }]);
    const e = plano(z2).itens[0].entrada;
    expect(() => extrairEntrada(z2, { ...e, crc: e.crc ^ 1 })).toThrow(/CRC/);
    const z3 = zip([{ nome: "a.pdf", dados: Buffer.concat([PDF, Buffer.alloc(300, 1)]), deflate: true }]);
    const e3 = plano(z3).itens[0].entrada;
    const lixo = Buffer.from(z3);
    lixo.fill(0xff, 30 + 5, 30 + 5 + 20);
    expect(() => extrairEntrada(lixo, e3)).toThrow(ErroZip);
  });
  it("ZIP maior que o limite é recusado", () => {
    expect(() => lerDiretorioZip(zip([{ nome: "a.pdf", dados: PDF }]), { ...LIMITES_PADRAO, maxZipBytes: 10 })).toThrow(/excede o limite/);
  });
  it("ZIP64 é recusado com mensagem clara", () => {
    const z = Buffer.from(zip([{ nome: "a.pdf", dados: PDF }]));
    z.writeUInt16LE(0xffff, z.length - 22 + 10);
    expect(() => lerDiretorioZip(z)).toThrow(/ZIP64/);
  });
});

describe("permissão de importação", () => {
  it("somente Admin e Gestor", () => {
    expect(["GED_ADMIN", "GED_GESTOR", "GED_USUARIO", "GED_LEITOR", "GED_AUDITOR"].map((papel) => podeImportarGed({ membro: { papel: papel as never } }))).toEqual([true, true, false, false, false]);
  });
});
