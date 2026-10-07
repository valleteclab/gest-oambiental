import { describe, expect, it } from "vitest";
import { chaveGed, documentoDaChaveGed, lerArquivoGed, salvarArquivoGed, validarChaveGed, validarUploadGed } from "@/lib/ged/storage";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("chaveGed", () => {
  it("monta ged/{org}/{ano}/{doc}/v{n}-{sha8}.{ext}", () => {
    expect(chaveGed(A, { documentoId: DOC, n: 3, sha8: "ABCDEF12", ext: ".PDF", ano: 2026 })).toBe(`ged/${A}/2026/${DOC}/v3-abcdef12.pdf`);
  });
  it("usa o ano corrente por padrão", () => {
    expect(chaveGed(A, { documentoId: DOC, n: 1, sha8: "00000000", ext: "pdf" })).toContain(`/${new Date().getFullYear()}/`);
  });
  it("valida cada parte", () => {
    expect(() => chaveGed("../x", { documentoId: DOC, n: 1, sha8: "00000000", ext: "pdf" })).toThrow();
    expect(() => chaveGed(A, { documentoId: "../../x", n: 1, sha8: "00000000", ext: "pdf" })).toThrow();
    expect(() => chaveGed(A, { documentoId: DOC, n: 0, sha8: "00000000", ext: "pdf" })).toThrow();
    expect(() => chaveGed(A, { documentoId: DOC, n: 1, sha8: "xyz", ext: "pdf" })).toThrow();
    expect(() => chaveGed(A, { documentoId: DOC, n: 1, sha8: "00000000", ext: "p/df" })).toThrow();
  });
  it("a chave gerada é aceita pelo dono e recusada por outro cliente", () => {
    const k = chaveGed(A, { documentoId: DOC, n: 1, sha8: "00000000", ext: "pdf", ano: 2026 });
    expect(validarChaveGed(A, k)).toBe(k);
    expect(() => validarChaveGed(B, k)).toThrow();
    expect(documentoDaChaveGed(k)).toBe(DOC);
  });
});

describe("lerArquivoGed recusa chaves perigosas (antes de qualquer E/S)", () => {
  const boa = `ged/${A}/2026/${DOC}/v1-00000000.pdf`;
  const ruins: [string, string][] = [
    ["chave de outro cliente", `ged/${B}/2026/${DOC}/v1-00000000.pdf`],
    ["..", `ged/${A}/2026/${DOC}/../../${B}/2026/${DOC}/v1-00000000.pdf`],
    ["..", `ged/${A}/../${B}/2026/${DOC}/v1-00000000.pdf`],
    ["URL", "https://exemplo.invalid/arquivo.pdf"],
    ["URL com prefixo", `ged/${A}/2026/${DOC}/http://x/v1-00000000.pdf`],
    ["caminho absoluto", `/etc/passwd`],
    ["absoluto com prefixo", `/ged/${A}/2026/${DOC}/v1-00000000.pdf`],
    ["barra invertida", `ged\\${A}\\2026\\${DOC}\\v1-00000000.pdf`],
    ["sem prefixo ged", `anexos/${A}/2026/${DOC}/v1-00000000.pdf`],
    ["prefixo de outro módulo", `${A}/processos/x/y.pdf`],
    ["byte nulo", `${boa}\u0000.png`],
    ["barras duplas", `ged//${A}/2026/${DOC}/v1-00000000.pdf`],
    ["vazia", ""],
    ["extensão inválida", `ged/${A}/2026/${DOC}/v1-00000000.p/df`],
  ];
  for (const [rotulo, k] of ruins) {
    it(`rejeita: ${rotulo}`, async () => {
      await expect(lerArquivoGed(A, k)).rejects.toThrow(/storage_key inválida/);
    });
  }
  it("rejeita chave não-string", async () => {
    // @ts-expect-error teste de robustez
    await expect(lerArquivoGed(A, null)).rejects.toThrow(/storage_key inválida/);
  });
  it("salvar também valida a chave", async () => {
    await expect(salvarArquivoGed(A, `ged/${B}/2026/${DOC}/v1-00000000.pdf`, Buffer.from("%PDF-"), "application/pdf", null)).rejects.toThrow(/storage_key inválida/);
  });
  it("orgId inválido é recusado", () => {
    expect(() => validarChaveGed("nao-uuid", boa)).toThrow();
  });
});

describe("validarUploadGed (somente PDF)", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
  it("aceita PDF válido e normaliza o nome", () => {
    const r = validarUploadGed(pdf, "Relatório Anual (final).PDF", "application/pdf");
    expect(r).toMatchObject({ ok: true, ext: "pdf", mime: "application/pdf" });
    if (r.ok) expect(r.nome).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
  });
  it("aceita octet-stream com assinatura %PDF-", () => {
    expect(validarUploadGed(pdf, "a.pdf", "application/octet-stream").ok).toBe(true);
  });
  it("recusa sem assinatura %PDF-", () => {
    expect(validarUploadGed(Buffer.from("MZ....."), "a.pdf", "application/pdf").ok).toBe(false);
    expect(validarUploadGed(Buffer.from("  %PDF-1.4"), "a.pdf", "application/pdf").ok).toBe(false);
  });
  it("recusa extensão e mime que não sejam PDF", () => {
    expect(validarUploadGed(pdf, "a.exe", "application/pdf").ok).toBe(false);
    expect(validarUploadGed(pdf, "a.pdf.exe", "application/pdf").ok).toBe(false);
    expect(validarUploadGed(pdf, "a.pdf", "text/html").ok).toBe(false);
  });
  it("recusa vazio e acima do limite", () => {
    expect(validarUploadGed(Buffer.alloc(0), "a.pdf", "application/pdf").ok).toBe(false);
    const grande = Buffer.concat([pdf, Buffer.alloc(25 * 1024 * 1024)]);
    expect(validarUploadGed(grande, "a.pdf", "application/pdf").ok).toBe(false);
  });
  it("nome com caminho não vaza diretórios", () => {
    const r = validarUploadGed(pdf, "../../etc/passwd.pdf", "application/pdf");
    expect(r.ok && r.nome).toBe("passwd.pdf");
  });
});
