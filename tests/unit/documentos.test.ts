import { describe, expect, it } from "vitest";
import {
  aplicarPlaceholders,
  dominioDe,
  esc,
  formatarEndereco,
  normalizarCodigo,
  sanitizarHtml,
  statusPublico,
  textoParaHtml,
  titularPublico,
} from "@/lib/documentos/render";
import { gerarCodigoVerificador } from "@/lib/crypto";
import { MODELOS, rodape, type ContextoDocumento } from "@/templates";
import { renderizarDocumento } from "@/lib/documentos/modelo";

const ctxBase = (over: Partial<ContextoDocumento> = {}): ContextoDocumento => ({
  tipo: "LICENCA",
  titulo: "Licença de Operação",
  numero: "LO-LOR-001/2026",
  codigo: "7KQ2-M9XA-D3PL",
  url_validacao: "https://licenciagov.exemplo/validar/7KQ2-M9XA-D3PL",
  dominio: "licenciagov.exemplo",
  emitido_em: new Date("2026-09-27T15:00:00Z"),
  signatario: { nome: "Gestora <Teste>", cargo: "Secretária" },
  municipio: { nome: "Lagoa do Orvalho", sigla: "LOR", orgao: "Secretaria de Meio Ambiente", endereco: null, email: null, telefone: null, brasao: "data:image/svg+xml;base64,AA==", organizacao: null },
  titular: { nome: "Maria <script>alert(1)</script>", tipo: "PF", documento: "***.456.789-**", endereco: "Rua A" },
  processo: { numero: "LOR-2026-000001", data_protocolo: new Date("2026-09-01T12:00:00Z"), tipo_ato_nome: "Licença de Operação", tipo_ato_sigla: "LO", descricao_atividade: null },
  empreendimento: null,
  rt: null,
  validade_ate: new Date("2030-09-27T12:00:00Z"),
  condicionantes: [{ descricao: "Monitorar <efluentes> & resíduos", periodicidade: "Semestral" }],
  parecer: null,
  auto: null,
  notificacao: null,
  fiscalizacao: null,
  anexos: [],
  dados: {},
  ...over,
});

describe("escape e placeholders", () => {
  it("esc escapa caracteres HTML", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(esc(null)).toBe("");
  });

  it("{{x}} escapa, {{{x}}} sanitiza, caminhos aninhados e desconhecidos", () => {
    const html = aplicarPlaceholders("<p>{{titular.nome}}</p>{{{bloco}}}<i>{{nao.existe}}</i>{{ numero }}", {
      titular: { nome: "<b>Zé</b>" },
      bloco: '<ul><li onclick="x()">ok</li></ul><script>alert(1)</script>',
      numero: 42,
    });
    expect(html).toBe("<p>&lt;b&gt;Zé&lt;/b&gt;</p><ul><li>ok</li></ul><i></i>42");
  });

  it("sanitizarHtml remove scripts, eventos, iframes, imagens e URLs", () => {
    const s = sanitizarHtml(`<p style="x" onmouseover="a()">t<img src="http://evil/x.png"><a href="javascript:x">l</a></p><iframe src="x"></iframe><script>bad()</script><table><tr><td colspan="2">c</td></tr></table>`);
    expect(s).not.toMatch(/script|onmouseover|iframe|img|href|style|evil/i);
    expect(s).toContain("<td colspan=\"2\">c</td>");
    expect(s).toContain("<p>t");
  });

  it("sanitizarHtml neutraliza tag não fechada", () => {
    expect(sanitizarHtml("a <script")).toBe("a &lt;script");
    expect(sanitizarHtml("<p onclick=alert(1) x")).toBe("&lt;p onclick=alert(1) x");
  });

  it("textoParaHtml gera parágrafos escapados", () => {
    expect(textoParaHtml("a<b\nlinha\n\nb")).toBe("<p>a&lt;b<br>linha</p><p>b</p>");
  });

  it("formatarEndereco aceita objeto ou string", () => {
    expect(formatarEndereco({ logradouro: "Rua A", numero: "10", bairro: "Centro", cidade: "Lagoa do Orvalho", uf: "BA", cep: "46880-000" })).toBe("Rua A, 10 – Centro – Lagoa do Orvalho/BA – CEP 46880-000");
    expect(formatarEndereco("Praça X")).toBe("Praça X");
    expect(formatarEndereco(null)).toBe("");
  });
});

describe("código verificador e status público", () => {
  it("normaliza códigos digitados e rejeita inválidos", () => {
    const c = gerarCodigoVerificador();
    expect(normalizarCodigo(c)).toBe(c);
    expect(normalizarCodigo(c.toLowerCase().replaceAll("-", " "))).toBe(c);
    expect(normalizarCodigo("ABC")).toBeNull();
    expect(normalizarCodigo("1111-1111-1111")).toBeNull(); // '1' não existe no alfabeto
    expect(normalizarCodigo("'; drop table--")).toBeNull();
  });

  it("VÁLIDO vira VENCIDO após a validade; CANCELADO/SUBSTITUIDO prevalecem", () => {
    const agora = new Date("2026-09-27T12:00:00Z");
    expect(statusPublico({ status: "VALIDO", validade_ate: null }, agora)).toBe("VALIDO");
    expect(statusPublico({ status: "VALIDO", validade_ate: new Date("2026-09-27T00:00:00Z") }, agora)).toBe("VALIDO");
    expect(statusPublico({ status: "VALIDO", validade_ate: new Date("2026-09-26T00:00:00Z") }, agora)).toBe("VENCIDO");
    expect(statusPublico({ status: "CANCELADO", validade_ate: new Date("2020-01-01") }, agora)).toBe("CANCELADO");
    expect(statusPublico({ status: "SUBSTITUIDO", validade_ate: null }, agora)).toBe("SUBSTITUIDO");
  });

  it("titularPublico abrevia PF e mantém PJ; documento sempre mascarado", () => {
    expect(titularPublico({ tipo: "PF", nome: "Maria de Lourdes Oliveira", cpf_cnpj_mascara: "***.444.777-**" })).toEqual({ nome: "Maria L. O.", documento: "***.444.777-**" });
    expect(titularPublico({ tipo: "PJ", nome: "Laticínio Boa Vista Ltda", cpf_cnpj_mascara: "11.222.333/****-**" })).toEqual({ nome: "Laticínio Boa Vista Ltda", documento: "11.222.333/****-**" });
    expect(titularPublico({ tipo: "PF", nome: "Fulano", cpf_cnpj_mascara: null })?.documento).toBe("***");
    expect(titularPublico(null)).toBeNull();
  });

  it("dominioDe extrai host", () => {
    expect(dominioDe("https://licenciagov.ba.gov.br/x")).toBe("licenciagov.ba.gov.br");
    expect(dominioDe("http://localhost:3000")).toBe("localhost:3000");
  });
});

describe("modelos embutidos", () => {
  it("todos os tipos renderizam com título, número, assinatura e sem HTML injetado", () => {
    for (const tipo of Object.keys(MODELOS) as ContextoDocumento["tipo"][]) {
      const html = MODELOS[tipo](ctxBase({ tipo, dados: { texto: "<img src=x onerror=alert(1)>", motivo: "m", exigencia: "e" } }));
      expect(html).toContain("LO-LOR-001/2026");
      expect(html).toContain("Gestora &lt;Teste&gt;");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).not.toContain("<img src=x");
    }
  });

  it("licença lista condicionantes escapadas e validade", () => {
    const html = MODELOS.LICENCA(ctxBase());
    expect(html).toContain("Monitorar &lt;efluentes&gt; &amp; resíduos");
    expect(html).toContain("27/09/2030");
  });

  it("rodapé traz QR, código, domínio de validação e signatário", () => {
    const r = rodape(ctxBase(), "data:image/png;base64,QQ==");
    expect(r).toContain("data:image/png;base64,QQ==");
    expect(r).toContain("licenciagov.exemplo/validar");
    expect(r).toContain("7KQ2-M9XA-D3PL");
    expect(r).toContain("Gestora &lt;Teste&gt;");
    expect(r).toContain("pageNumber");
  });

  it("modelo do banco: fragmento recebe cabeçalho; placeholders escapados", () => {
    const html = renderizarDocumento(ctxBase(), "<p>Titular: {{titular.nome}} válido até {{validade}}</p>{{{condicionantes_html}}}");
    expect(html).toContain("Titular: Maria &lt;script&gt;");
    expect(html).toContain("27/09/2030");
    expect(html).toContain("<ol class=\"cond\">");
    expect(html).toContain("Secretaria de Meio Ambiente"); // cabeçalho institucional
  });
});
