import { describe, expect, it } from "vitest";
import {
  ajustarAoCaminhoMaximo, CABECALHO_MANIFESTO, Desambiguador, LIMITE_ARQUIVOS_ZIP, linhaOmitida, montarLeiame, montarManifesto, nomeArquivoZip, precisaZip64,
  sanitizarSegmento, verificarLimiteArquivos,
} from "@/lib/ged/exportacao-pasta/regras";
import { escolherVersao, nomeDoArquivo, rotuloSituacaoAssinatura } from "@/lib/ged/exportacao-pasta/servico";

describe("sanitizarSegmento", () => {
  it("troca caracteres inválidos do Windows e controles", () => {
    expect(sanitizarSegmento('Nota: 1/2 <teste> "x" | ? *')).toBe("Nota_ 1_2 _teste_ _x_ _ _ _");
    expect(sanitizarSegmento("a\u0000b\tc")).toBe("a_b_c");
  });
  it("mantém acentos (NFC) e remove ponto/espaço finais", () => {
    expect(sanitizarSegmento("Licitação. ")).toBe("Licitação");
    expect(sanitizarSegmento("Licitação".normalize("NFD"))).toBe("Licitação");
  });
  it("evita nomes reservados e vazios", () => {
    expect(sanitizarSegmento("CON")).toBe("_CON");
    expect(sanitizarSegmento("nul")).toBe("_nul");
    expect(sanitizarSegmento("COM1.pdf", { arquivo: true })).toBe("_COM1.pdf");
    expect(sanitizarSegmento("...")).toBe("_");
    expect(sanitizarSegmento("")).toBe("_");
  });
  it("limita a 120 caracteres preservando a extensão", () => {
    const r = sanitizarSegmento(`${"a".repeat(300)}.pdf`, { arquivo: true });
    expect(r.length).toBe(120);
    expect(r.endsWith(".pdf")).toBe(true);
    expect(sanitizarSegmento("p".repeat(300)).length).toBe(120);
  });
});

describe("Desambiguador", () => {
  it("sufixa duplicados sem diferenciar maiúsculas e antes da extensão", () => {
    const d = new Desambiguador();
    expect(d.reservar("A", "Contrato.pdf", true)).toBe("Contrato.pdf");
    expect(d.reservar("A", "CONTRATO.pdf", true)).toBe("CONTRATO (2).pdf");
    expect(d.reservar("A", "contrato.pdf", true)).toBe("contrato (3).pdf");
    expect(d.reservar("B", "Contrato.pdf", true)).toBe("Contrato.pdf"); // outro diretório
  });
  it("respeita o máximo do segmento ao sufixar", () => {
    const d = new Desambiguador(20);
    const n = "x".repeat(16) + ".pdf";
    d.reservar("", n, true);
    const r = d.reservar("", n, true);
    expect(r.length).toBeLessThanOrEqual(20);
    expect(r.endsWith(" (2).pdf")).toBe(true);
  });
  it("pasta e arquivo dividem o espaço de nomes", () => {
    const d = new Desambiguador();
    d.reservar("", "Doc");
    expect(d.reservar("", "doc")).toBe("doc (2)");
  });
});

describe("caminho máximo", () => {
  it("encurta só o arquivo, mantendo a extensão", () => {
    const dir = "D".repeat(100);
    const r = ajustarAoCaminhoMaximo(dir, `${"n".repeat(200)}.pdf`);
    expect(`${dir}/${r}`.length).toBeLessThanOrEqual(200);
    expect(r.endsWith(".pdf")).toBe(true);
  });
  it("não mexe quando cabe", () => expect(ajustarAoCaminhoMaximo("A", "b.pdf")).toBe("b.pdf"));
});

describe("limite e ZIP64", () => {
  it("20.000 é o teto; acima orienta dividir por subpasta", () => {
    expect(LIMITE_ARQUIVOS_ZIP).toBe(20_000);
    expect(verificarLimiteArquivos(20_000).ok).toBe(true);
    const r = verificarLimiteArquivos(20_001);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toMatch(/subpasta/);
    expect(verificarLimiteArquivos(5, 3).ok).toBe(false);
  });
  it("ZIP64 por tamanho estimado ou nº de entradas", () => {
    expect(precisaZip64(1024 ** 3, 100)).toBe(false);
    expect(precisaZip64(4 * 1024 ** 3, 100)).toBe(true);
    expect(precisaZip64(10, 70_000)).toBe(true);
  });
});

describe("nome do ZIP", () => {
  it("PASTA-AAAA-MM-DD.zip com a data de Brasília", () => {
    expect(nomeArquivoZip("Prestação de Contas", new Date("2026-03-01T02:00:00Z"))).toBe("Prestação-de-Contas-2026-02-28.zip");
    expect(nomeArquivoZip("a/b:c", new Date("2026-10-07T15:00:00Z"))).toBe("a_b_c-2026-10-07.zip");
  });
});

describe("manifesto e LEIAME", () => {
  const l = { caminho: "P/a.pdf", numero: "CAM-DOC-2026-000001", titulo: 'Contrato "X"; =cmd', tipo: "Contrato", data_documento: "01/02/2026", situacao_documento: "PUBLICADO", assinatura: "sem assinatura", versao: "v1 (UPLOAD)", sha256: "ab", tamanho: 10, paginas: 3, situacao: "incluido" };
  it("cabeçalho, escape e dpi não verificado", () => {
    const csv = montarManifesto([l]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [cab, linha] = csv.slice(1).split("\r\n");
    expect(cab.split(";")).toEqual(CABECALHO_MANIFESTO);
    expect(linha).toContain('"Contrato ""X""; =cmd"');
    expect(linha).toContain("nao verificado");
    expect(linha).toContain(";3;");
  });
  it("omitido não leva título nem número nem dpi", () => {
    const csv = montarManifesto([linhaOmitida("Pasta/Sub")]);
    const linha = csv.slice(1).split("\r\n")[1];
    expect(linha).toBe("Pasta/Sub;;;;;;;;;;;;omitido: sem permissao");
  });
  it("LEIAME traz Brasília, quem exportou e o aviso do TCM (<250 DPI, sem verificação)", () => {
    const t = montarLeiame({ pasta: "A/B", organizacao: "Câmara X", exportadoPor: "Maria", geradoEm: new Date("2026-10-07T15:30:00Z"), incluidos: 3, omitidos: 1, erros: 0, bytes: 2_097_152, modoVersao: "atual" });
    expect(t).toContain("Maria");
    expect(t).toMatch(/07\/10\/2026.*12:30/);
    expect(t).toMatch(/250 DPI/);
    expect(t).toMatch(/NÃO verifica/);
    expect(t).toContain("2,0 MB");
  });
});

describe("versão e nome do arquivo", () => {
  const v = (n: number, origem: string, extra: Record<string, unknown> = {}) => ({ id: `v${n}`, documento_id: "d", n, origem, derivada_de_id: null, storage_key: "k", nome_arquivo: `arq${n}.pdf`, mime: "application/pdf", tamanho: 1, sha256: "s", paginas: null, selada: false, created_at: new Date(), ...extra });
  const vs = [v(1, "UPLOAD", { nome_arquivo: "Contrato 01.pdf" }), v(2, "OCR", { derivada_de_id: "v1", nome_arquivo: "ocr.pdf" })];
  it("padrão: versão atual (OCR); original: a base", () => {
    expect(escolherVersao({ versao_atual_id: "v2", status: "PUBLICADO" }, vs, "atual")?.id).toBe("v2");
    expect(escolherVersao({ versao_atual_id: "v2", status: "PUBLICADO" }, vs, "original")?.id).toBe("v1");
  });
  it("assinado/selado sempre sai o PDF selado", () => {
    const sel = [...vs, v(3, "SELO", { derivada_de_id: "v2", selada: true })];
    expect(escolherVersao({ versao_atual_id: "v3", status: "ASSINADO" }, sel, "original")?.id).toBe("v3");
    expect(rotuloSituacaoAssinatura("ASSINADO", true)).toMatch(/selado/);
    expect(rotuloSituacaoAssinatura("PUBLICADO", false)).toBe("sem assinatura");
  });
  it("sem versão atual → null", () => expect(escolherVersao({ versao_atual_id: null, status: "RASCUNHO" }, [], "atual")).toBeNull());
  it("nome = original do envio; sem envio, o número do documento", () => {
    expect(nomeDoArquivo("CAM-DOC-1", vs[1], vs)).toBe("Contrato 01.pdf");
    expect(nomeDoArquivo("CAM-DOC-1", v(1, "EDITOR", { nome_arquivo: "editor.pdf" }), [v(1, "EDITOR")])).toBe("CAM-DOC-1.pdf");
    expect(nomeDoArquivo("N", v(1, "UPLOAD", { nome_arquivo: "semext" }), [v(1, "UPLOAD", { nome_arquivo: "semext" })])).toBe("semext.pdf");
  });
});
