import { describe, expect, it } from "vitest";
import { estadoDoEditor, htmlTemConteudo, nomeArquivoPdf } from "@/lib/ged/editor/regras";
import { decodificarEntidades, hrefSeguro, sanitizarHtmlEditor as san } from "@/lib/ged/editor/sanitizar";
import { htmlParaTexto } from "@/lib/ged/documentos/pdf-info";

describe("sanitizarHtmlEditor – conteúdo legítimo do TipTap", () => {
  it("mantém formatação, títulos, listas e tabelas", () => {
    const h = '<h2 style="text-align: center">Título</h2><p><strong>a</strong> <em>b</em> <u>c</u> <s>d</s></p><ul><li><p>x</p></li></ul><ol start="3"><li>y</li></ol>' +
      '<table><tbody><tr><th colspan="2" rowspan="1" colwidth="100,100">H</th></tr><tr><td>1</td><td style="text-align:right">2</td></tr></tbody></table><blockquote>q</blockquote><pre><code>x</code></pre>';
    const s = san(h);
    expect(s).toContain('<h2 style="text-align: center">Título</h2>');
    expect(s).toContain("<strong>a</strong>");
    expect(s).toContain('<th colspan="2" rowspan="1">H</th>');
    expect(s).not.toContain("colwidth");
    expect(s).toContain('<td style="text-align: right">2</td>');
    expect(s).toContain('<ol start="3">');
    expect(s).toContain("<blockquote>q</blockquote>");
  });
  it("links http/https/mailto com rel seguro", () => {
    expect(san('<a href="https://exemplo.gov.br/x?a=1&amp;b=2">l</a>')).toBe('<a href="https://exemplo.gov.br/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">l</a>');
    expect(san('<a href="mailto:a@b.co">m</a>')).toContain('href="mailto:a@b.co"');
  });
  it("preserva texto com & e acentos", () => {
    expect(san("<p>Tom &amp; Jerry – ação</p>")).toBe("<p>Tom &amp; Jerry – ação</p>");
  });
});

describe("sanitizarHtmlEditor – XSS", () => {
  const casos: [string, string][] = [
    ["script", "<p>a</p><script>alert(1)</script>"],
    ["script em maiúsculas/ofuscado", "<ScRiPt >alert(1)</sCrIpT>"],
    ["script sem fechamento", "<script>alert(1)"],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["svg onload", '<svg onload="alert(1)"><circle/></svg>'],
    ["iframe", '<iframe src="https://evil.test"></iframe>'],
    ["objeto/embed", '<object data="x"></object><embed src="x">'],
    ["style tag", "<style>body{background:url(javascript:alert(1))}</style>"],
    ["link javascript", '<a href="javascript:alert(1)">x</a>'],
    ["link javascript com tab/entidade", '<a href="jav&#x09;ascript:alert(1)">x</a>'],
    ["link javascript com &Tab;", '<a href="java&Tab;script:alert(1)">x</a>'],
    ["link javascript com espaços e maiúsculas", '<a href="  JaVaScRiPt:alert(1)">x</a>'],
    ["link data", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'],
    ["link vbscript", '<a href="vbscript:msgbox(1)">x</a>'],
    ["evento em p", '<p onclick="alert(1)" onmouseover=alert(1)>x</p>'],
    ["evento com aspas simples", "<p onclick='alert(1)'>x</p>"],
    ["style com expression/url", '<p style="background:url(javascript:alert(1))">x</p>'],
    ["form/button", '<form action="https://evil.test"><button>go</button><input name=a></form>'],
    ["< solto", "<<script>alert(1)//<</script>"],
    ["tag sem fechar >", "<img src=x onerror=alert(1)"],
    ["comentário condicional", "<!--[if IE]><script>alert(1)</script><![endif]-->"],
    ["meta refresh/base", '<meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test">'],
    ["atributo > dentro de aspas", '<p title="a>b" onclick="alert(1)">x</p>'],
    ["math/template", "<math><mi xlink:href=javascript:alert(1)>x</mi></math><template><script>alert(1)</script></template>"],
    ["textarea/xmp", "<textarea><script>alert(1)</script></textarea><xmp><script>alert(1)</script></xmp>"],
  ];
  for (const [nome, entrada] of casos) {
    it(`neutraliza: ${nome}`, () => {
      const s = san(entrada);
      expect(s).not.toMatch(/<script|<img|<svg|<iframe|<object|<embed|<style|<form|<input|<button|<meta|<base|<math|<template|<textarea/i);
      expect(s).not.toMatch(/<[^>]*\son\w+\s*=/i);
      expect(s).not.toMatch(/javascript:|vbscript:|data:text/i);
      // nenhum "<" que não seja início de tag permitida
      for (const m of s.matchAll(/<(\/?)([a-z0-9]*)/gi)) expect(["", "p", "a", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "span", "div", "pre", "code", "sub", "sup", "mark"]).toContain(m[2].toLowerCase());
    });
  }
  it("é idempotente", () => {
    const h = '<h1>a</h1><p style="text-align: right">b <a href="https://x.gov.br">l</a></p><table><tr><td colspan="2">c</td></tr></table>';
    expect(san(san(h))).toBe(san(h));
  });
  it("nunca produz atributo style além de text-align", () => {
    expect(san('<p style="color:red;position:fixed">x</p>')).toBe("<p>x</p>");
    expect(san('<p style="text-align:center;background:red">x</p>')).toBe("<p>x</p>");
  });
  it("não lança com entradas esquisitas", () => {
    for (const x of [null, undefined, 123, "", "<", ">", "<>", "</", "<a", '<a href="', "&#", "&#xZZ;", "\u0000<script>"]) expect(() => san(x)).not.toThrow();
  });
});

describe("hrefSeguro / entidades", () => {
  it("só http(s) e mailto", () => {
    expect(hrefSeguro("https://a.b")).toBe("https://a.b");
    expect(hrefSeguro("/relativo")).toBeNull();
    expect(hrefSeguro("//evil.test")).toBeNull();
    expect(hrefSeguro("ftp://x")).toBeNull();
    expect(hrefSeguro("javascript:alert(1)")).toBeNull();
    expect(hrefSeguro("java\tscript:alert(1)")).toBeNull();
  });
  it("decodifica entidades", () => {
    expect(decodificarEntidades("&#106;avascript&colon;")).toBe("javascript:");
    expect(decodificarEntidades("&#x6A;")).toBe("j");
    expect(decodificarEntidades("&#99999999;")).toBe("");
  });
});

describe("estado do editor", () => {
  const base = { versao_atual_origem: "EDITOR" as const, versao_atual_selada: false, temVersaoEditor: true };
  it("rascunho do editor", () => expect(estadoDoEditor({ ...base, status: "RASCUNHO" }).tipo).toBe("RASCUNHO"));
  it("publicado criado no editor → reabrir", () => expect(estadoDoEditor({ ...base, status: "PUBLICADO" }).tipo).toBe("REABRIR"));
  it("assinado/selado/arquivado/em assinatura → bloqueado", () => {
    expect(estadoDoEditor({ ...base, status: "ASSINADO" }).tipo).toBe("BLOQUEADO");
    expect(estadoDoEditor({ ...base, status: "PUBLICADO", versao_atual_selada: true }).tipo).toBe("BLOQUEADO");
    expect(estadoDoEditor({ ...base, status: "EM_ASSINATURA" }).tipo).toBe("BLOQUEADO");
    expect(estadoDoEditor({ ...base, status: "ARQUIVADO" }).tipo).toBe("BLOQUEADO");
  });
  it("upload (sem versão do editor) → bloqueado; rascunho de upload também", () => {
    expect(estadoDoEditor({ status: "PUBLICADO", versao_atual_origem: "UPLOAD", versao_atual_selada: false, temVersaoEditor: false }).tipo).toBe("BLOQUEADO");
    expect(estadoDoEditor({ status: "RASCUNHO", versao_atual_origem: "UPLOAD", versao_atual_selada: false, temVersaoEditor: false }).tipo).toBe("BLOQUEADO");
  });
});

describe("auxiliares", () => {
  it("nome do arquivo", () => {
    expect(nomeArquivoPdf("Ofício nº 12/2026 – Ação")).toBe("Oficio-n-12-2026-Acao.pdf");
    expect(nomeArquivoPdf("///")).toBe("documento.pdf");
  });
  it("conteúdo vazio", () => {
    expect(htmlTemConteudo(htmlParaTexto("<p> </p><p><br></p>"))).toBe(false);
    expect(htmlTemConteudo(htmlParaTexto("<h1>Oi</h1>"))).toBe(true);
  });
});

describe("papel timbrado (HTML do PDF)", () => {
  it("escapa título/nome e sanitiza o corpo", async () => {
    const { montarHtmlDocumento } = await import("@/lib/ged/editor/pdf");
    const html = await montarHtmlDocumento({
      organizacao: { nome: 'Câmara <script>x</script> "Fictícia"', logo_url: null },
      numero: "GTC-DOC-2026-000001",
      titulo: "<img src=x onerror=alert(1)>",
      html: '<p>ok</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
      data_documento: new Date("2026-10-01T00:00:00Z"),
    });
    expect(html).toContain("GTC-DOC-2026-000001");
    expect(html).toContain("01/10/2026");
    expect(html).not.toMatch(/<script|<img|javascript:/i);
    expect(html).toContain("<p>ok</p>");
    expect(html).toContain("Câmara &lt;script&gt;x&lt;/script&gt; &quot;Fictícia&quot;");
  });
});
