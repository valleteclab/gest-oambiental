import { describe, expect, it } from "vitest";
import { aplicarMarcaDadosPessoais, erroSensibilidade, podeExporPublicamente, whereExposicaoPublica } from "@/lib/ged/anonimizacao";
import { htmlParaTexto, paginasDeSaidaPdfinfo, textoEscasso } from "@/lib/ged/documentos/pdf-info";
import { dividirMarcado, montarTrechos } from "@/lib/ged/documentos/snippet";
import { podeNovaVersao, proximoNumeroVersao, sha256Hex } from "@/lib/ged/documentos/versoes";
import { statusAoRestaurar } from "@/lib/ged/documentos/servico";
import { montarArvore, type PastaNo } from "@/lib/ged/pastas";
import { cabecalhoDisposicao } from "@/lib/ged/documentos/arquivo-http";

describe("versões (helpers puros)", () => {
  it("próximo número", () => {
    expect(proximoNumeroVersao(null)).toBe(1);
    expect(proximoNumeroVersao(undefined)).toBe(1);
    expect(proximoNumeroVersao(7)).toBe(8);
  });
  it("sha256 hex", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("documento assinado/selado só aceita SELO", () => {
    expect(podeNovaVersao({ status: "PUBLICADO", ultimaSelada: false }, "UPLOAD")).toBe(true);
    expect(podeNovaVersao({ status: "ASSINADO", ultimaSelada: false }, "UPLOAD")).toBe(false);
    expect(podeNovaVersao({ status: "EM_ASSINATURA", ultimaSelada: true }, "EDITOR")).toBe(false);
    expect(podeNovaVersao({ status: "ASSINADO", ultimaSelada: true }, "SELO")).toBe(true);
  });
});

describe("pdf-info", () => {
  it("lê páginas do pdfinfo", () => {
    expect(paginasDeSaidaPdfinfo("Title: x\nPages:           12\nEncrypted: no")).toBe(12);
    expect(paginasDeSaidaPdfinfo("nada")).toBeNull();
  });
  it("texto escasso: menos de ~25 caracteres por página", () => {
    expect(textoEscasso("  \n\f ", 3)).toBe(true);
    expect(textoEscasso("a".repeat(24), 1)).toBe(true);
    expect(textoEscasso("a".repeat(25), 1)).toBe(false);
    expect(textoEscasso("a".repeat(100), 5)).toBe(true);
    expect(textoEscasso("a b ".repeat(60), null)).toBe(false);
  });
  it("html do editor vira texto", () => {
    expect(htmlParaTexto("<h1>Título</h1><p>Olá&nbsp;<b>mundo</b> &amp; cia</p><script>x()</script>")).toBe("Título\nOlá mundo & cia");
    expect(htmlParaTexto("<p>a\u0000b</p>")).toBe("a b");
  });
});

describe("snippet", () => {
  it("divide por marcas", () => {
    expect(dividirMarcado("um ⟦dois⟧ três")).toEqual([{ texto: "um ", destaque: false }, { texto: "dois", destaque: true }, { texto: " três", destaque: false }]);
  });
  it("reaplica acentos quando o alinhamento confere", () => {
    const t = montarTrechos("a ⟦agua⟧ tratada", "a água tratada");
    expect(t.map((x) => x.texto).join("")).toBe("a água tratada");
    expect(t.find((x) => x.destaque)?.texto).toBe("água");
  });
  it("mantém o texto sem acento se o original não confere (nunca inventa conteúdo)", () => {
    const t = montarTrechos("a ⟦agua⟧", "texto totalmente diferente!");
    expect(t.map((x) => x.texto).join("")).toBe("a agua");
    expect(montarTrechos("a ⟦agua⟧", null).map((x) => x.texto).join("")).toBe("a agua");
  });
  it("colapsa espaços/quebras", () => {
    expect(montarTrechos("  a\n\n  ⟦b⟧", null).map((x) => x.texto).join("")).toBe("a b");
  });
});

describe("anonimização – marcas", () => {
  const base = { sensibilidade: "PUBLICO", contem_dados_pessoais: false, anonimizacao_status: "NAO_NECESSARIA" } as const;
  it("marcar dados pessoais rebaixa PUBLICO e deixa PENDENTE", () => {
    expect(aplicarMarcaDadosPessoais(base, true)).toEqual({ contem_dados_pessoais: true, anonimizacao_status: "PENDENTE", sensibilidade: "RESTRITO", sensibilidade_rebaixada: true });
  });
  it("não rebaixa o que já é restrito/sigiloso; nunca produz PENDENTE + PUBLICO", () => {
    for (const s of ["PUBLICO", "RESTRITO", "SIGILOSO"] as const) {
      const r = aplicarMarcaDadosPessoais({ ...base, sensibilidade: s }, true);
      expect(r.anonimizacao_status === "PENDENTE" && r.sensibilidade === "PUBLICO").toBe(false);
    }
    expect(aplicarMarcaDadosPessoais({ ...base, sensibilidade: "SIGILOSO" }, true).sensibilidade).toBe("SIGILOSO");
  });
  it("desmarcar volta PENDENTE para NAO_NECESSARIA; ANONIMIZADA permanece", () => {
    expect(aplicarMarcaDadosPessoais({ sensibilidade: "RESTRITO", contem_dados_pessoais: true, anonimizacao_status: "PENDENTE" }, false)).toMatchObject({ contem_dados_pessoais: false, anonimizacao_status: "NAO_NECESSARIA" });
    expect(aplicarMarcaDadosPessoais({ sensibilidade: "RESTRITO", contem_dados_pessoais: true, anonimizacao_status: "ANONIMIZADA" }, true).anonimizacao_status).toBe("ANONIMIZADA");
  });
  it("erroSensibilidade: original com dados pessoais/pendente não vira PUBLICO; derivado pode", () => {
    const pend = { sensibilidade: "RESTRITO", contem_dados_pessoais: true, anonimizacao_status: "PENDENTE" } as const;
    expect(erroSensibilidade("PUBLICO", pend)).toMatch(/pendente/);
    expect(erroSensibilidade("PUBLICO", { ...pend, anonimizacao_status: "ANONIMIZADA" })).toMatch(/dados pessoais/);
    expect(erroSensibilidade("PUBLICO", { ...pend, anonimizacao_status: "ANONIMIZADA", documento_original_id: "x" })).toBeNull();
    expect(erroSensibilidade("RESTRITO", pend)).toBeNull();
    expect(erroSensibilidade("PUBLICO", { sensibilidade: "RESTRITO", contem_dados_pessoais: false, anonimizacao_status: "NAO_NECESSARIA" })).toBeNull();
  });
});

describe("anonimização – exposição pública", () => {
  const d = { status: "PUBLICADO", excluido_em: null, sensibilidade: "PUBLICO", contem_dados_pessoais: false, anonimizacao_status: "NAO_NECESSARIA", documento_original_id: null } as const;
  it("original limpo e PUBLICO é público", () => expect(podeExporPublicamente(d)).toBe(true));
  it("original com dados pessoais / anonimização PENDENTE / ANONIMIZADA nunca é público", () => {
    expect(podeExporPublicamente({ ...d, contem_dados_pessoais: true })).toBe(false);
    expect(podeExporPublicamente({ ...d, anonimizacao_status: "PENDENTE" })).toBe(false);
    expect(podeExporPublicamente({ ...d, anonimizacao_status: "ANONIMIZADA" })).toBe(false);
  });
  it("derivado anonimizado PUBLICO é público", () => {
    expect(podeExporPublicamente({ ...d, anonimizacao_status: "ANONIMIZADA", documento_original_id: "orig" })).toBe(true);
  });
  it("rascunho, arquivado, excluído e não-PUBLICO não são públicos", () => {
    expect(podeExporPublicamente({ ...d, status: "RASCUNHO" })).toBe(false);
    expect(podeExporPublicamente({ ...d, status: "ARQUIVADO" })).toBe(false);
    expect(podeExporPublicamente({ ...d, excluido_em: new Date() })).toBe(false);
    expect(podeExporPublicamente({ ...d, sensibilidade: "RESTRITO" })).toBe(false);
  });
  it("where tem as mesmas condições-chave", () => {
    const w = whereExposicaoPublica();
    expect(w).toMatchObject({ excluido_em: null, sensibilidade: "PUBLICO", contem_dados_pessoais: false });
    expect(JSON.stringify(w)).toContain("NAO_NECESSARIA");
  });
});

describe("restaurar status", () => {
  it("usa o status auditado ou deduz", () => {
    expect(statusAoRestaurar("RASCUNHO", false)).toBe("RASCUNHO");
    expect(statusAoRestaurar("EM_ASSINATURA", false)).toBe("PUBLICADO");
    expect(statusAoRestaurar(undefined, true)).toBe("ASSINADO");
    expect(statusAoRestaurar(undefined, false)).toBe("PUBLICADO");
  });
});

describe("árvore de pastas", () => {
  const p = (id: string, parent_id: string | null, nome: string): PastaNo => ({ id, parent_id, nome, caminho_nome: nome, herda_acl: true, sensibilidade_padrao: "RESTRITO", arquivada: false, documentos: 0 });
  it("monta a árvore ordenada; filha cujo pai não é visível vira raiz", () => {
    const t = montarArvore([p("c", "a", "Zeta"), p("a", null, "Alfa"), p("b", "a", "Beta"), p("x", "oculta", "Órfã")]);
    expect(t.map((n) => n.nome)).toEqual(["Alfa", "Órfã"]);
    expect(t[0].filhas.map((n) => n.nome)).toEqual(["Beta", "Zeta"]);
  });
});

describe("Content-Disposition seguro", () => {
  it("attachment/inline com filename ASCII e RFC 5987", () => {
    const h = cabecalhoDisposicao("inline", "Relatório de água.pdf");
    expect(h).toBe(`inline; filename="Relatorio de agua.pdf"; filename*=UTF-8''Relat%C3%B3rio%20de%20%C3%A1gua.pdf`);
  });
  it("neutraliza aspas, quebras de linha e barras (sem injeção de cabeçalho)", () => {
    const h = cabecalhoDisposicao("attachment", 'a"b\r\nX-Evil: 1/../c.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split(";")[1]).not.toContain('"b');
    expect(h).not.toContain("/");
  });
  it("nome vazio vira 'documento'", () => {
    expect(cabecalhoDisposicao("attachment", "")).toContain('filename="documento"');
  });
});
