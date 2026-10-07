import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { hashElo, ordenarCronologico, sha256Texto, verificarCadeia } from "@/lib/ged/assinaturas/cadeia";
import { htmlFolhaAssinaturas, type DadosFolha } from "@/lib/ged/assinaturas/folha";
import {
  calcularPrazoAssinatura, daVez, diasCivisEntre, ehCodigoVerificador, fmtDataHoraBrasilia, lembreteDevido, montarAssinantes, normalizarCodigoGed,
  podeAssinarAgora, podeSolicitarNoStatus, podeTransitarAssinante, podeTransitarSolicitacao, prazoExpirado, proximosAPromover, statusDocumentoAposEncerrar,
  textoRodapeSelo, todosAssinaram, urlVerificacao, visualParaNativo,
} from "@/lib/ged/assinaturas/regras";
import { anexarPaginas, estamparRodape } from "@/lib/ged/assinaturas/selo-pdf";
import { zAssinar, zRecusar, zSolicitarAssinatura } from "@/lib/ged/assinaturas/validacao";
import { gerarCodigoVerificador } from "@/lib/crypto";

const ALVO = sha256Texto("arquivo original");
const U = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

type Linha = Parameters<typeof verificarCadeia>[1][number];
function cadeiaDe(n = 3): Linha[] {
  const base = Date.UTC(2026, 9, 7, 15, 0, 0);
  const linhas: Linha[] = [];
  let anterior = ALVO;
  for (let i = 0; i < n; i++) {
    const l = { assinante_id: `a${i}`, usuario_id: U[i % 3], hash_documento: ALVO, assinado_em: new Date(base + i * 60_000), metodo: "ELETRONICA_AVANCADA", ordem: i + 1, status: "ASSINADO", hash_cadeia: "" };
    l.hash_cadeia = hashElo(anterior, l);
    anterior = l.hash_cadeia;
    linhas.push(l);
  }
  return linhas;
}

describe("cadeia de hashes", () => {
  it("é determinística e o primeiro elo parte do sha256_alvo", () => {
    const [a] = cadeiaDe(1);
    expect(a.hash_cadeia).toBe(sha256Texto([ALVO, a.assinante_id, a.usuario_id, ALVO, new Date(a.assinado_em!).toISOString(), "ELETRONICA_AVANCADA"].join("|")));
    expect(a.hash_cadeia).toMatch(/^[0-9a-f]{64}$/);
  });
  it("cadeia íntegra passa e informa o último hash", () => {
    const l = cadeiaDe(3);
    const r = verificarCadeia(ALVO, l);
    expect(r).toMatchObject({ ok: true, elos: 3, ultimo_hash: l[2].hash_cadeia });
  });
  it("detecta adulteração de CADA campo de CADA elo", () => {
    const campos: [keyof Linha, unknown][] = [
      ["assinante_id", "outro"], ["usuario_id", "99999999-9999-4999-8999-999999999999"], ["hash_documento", sha256Texto("x")], ["assinado_em", new Date(Date.UTC(2026, 9, 7, 15, 0, 1))], ["metodo", "ICP_BRASIL_A1"], ["hash_cadeia", sha256Texto("forjado")],
    ];
    for (let i = 0; i < 3; i++) {
      for (const [campo, valor] of campos) {
        const l = cadeiaDe(3).map((x) => ({ ...x }));
        (l[i] as Record<string, unknown>)[campo] = valor;
        const r = verificarCadeia(ALVO, l);
        expect(r.ok, `${String(campo)} do elo ${i}`).toBe(false);
      }
    }
  });
  it("uma adulteração no meio quebra o elo adulterado e os seguintes (não os anteriores)", () => {
    const l = cadeiaDe(4).map((x) => ({ ...x }));
    l[1].usuario_id = U[2];
    const r = verificarCadeia(ALVO, l);
    expect(r.erros.map((e) => e.assinante_id)).toEqual(["a1", "a2", "a3"]);
  });
  it("sha256_alvo diferente invalida tudo; hash_documento ≠ alvo é apontado", () => {
    expect(verificarCadeia(sha256Texto("outro"), cadeiaDe(2)).ok).toBe(false);
    const l = cadeiaDe(2).map((x) => ({ ...x }));
    l[0].hash_documento = sha256Texto("trocado");
    expect(verificarCadeia(ALVO, l).erros.some((e) => e.campo === "hash_documento")).toBe(true);
  });
  it("trocar a ordem cronológica (assinado_em) é detectado; a ordem do array não importa", () => {
    const l = cadeiaDe(3);
    expect(verificarCadeia(ALVO, [...l].reverse()).ok).toBe(true);
    const t = l.map((x) => ({ ...x }));
    [t[0].assinado_em, t[1].assinado_em] = [t[1].assinado_em, t[0].assinado_em];
    expect(verificarCadeia(ALVO, t).ok).toBe(false);
  });
  it("linha ASSINADO incompleta é erro; linhas não assinadas são ignoradas", () => {
    const l = cadeiaDe(2).map((x) => ({ ...x }));
    l[1].hash_cadeia = null;
    expect(verificarCadeia(ALVO, l).erros[0].campo).toBe("dados");
    const pend: Linha = { assinante_id: "p", usuario_id: U[0], hash_documento: "", assinado_em: null, metodo: "", ordem: 9, status: "PENDENTE", hash_cadeia: null };
    expect(verificarCadeia(ALVO, [...cadeiaDe(2), pend]).ok).toBe(true);
  });
  it("ordenarCronologico põe quem não assinou por último", () => {
    const o = ordenarCronologico([{ assinado_em: null, ordem: 1 }, { assinado_em: new Date(5), ordem: 2 }, { assinado_em: new Date(1), ordem: 3 }]);
    expect(o.map((x) => x.ordem)).toEqual([3, 2, 1]);
  });
});

describe("turno sequencial/paralelo", () => {
  const mk = (st: string[]) => st.map((status, i) => ({ id: `s${i}`, ordem: i + 1, status: status as never }));
  it("montarAssinantes: sequencial só o primeiro pendente; paralelo todos", () => {
    expect(montarAssinantes("SEQUENCIAL", U).map((a) => a.status)).toEqual(["PENDENTE", "AGUARDANDO", "AGUARDANDO"]);
    expect(montarAssinantes("PARALELO", U).map((a) => a.status)).toEqual(["PENDENTE", "PENDENTE", "PENDENTE"]);
    expect(montarAssinantes("SEQUENCIAL", U).map((a) => a.ordem)).toEqual([1, 2, 3]);
  });
  it("sequencial: só a vez; paralelo: qualquer pendente", () => {
    const seq = mk(["PENDENTE", "AGUARDANDO", "AGUARDANDO"]);
    expect(podeAssinarAgora("SEQUENCIAL", seq, "s0")).toBe(true);
    expect(podeAssinarAgora("SEQUENCIAL", seq, "s1")).toBe(false);
    expect(podeAssinarAgora("PARALELO", mk(["PENDENTE", "PENDENTE"]), "s1")).toBe(true);
    expect(podeAssinarAgora("PARALELO", mk(["ASSINADO", "PENDENTE"]), "s0")).toBe(false);
    expect(podeAssinarAgora("PARALELO", mk(["RECUSADO", "PENDENTE"]), "s0")).toBe(false);
    expect(podeAssinarAgora("SEQUENCIAL", seq, "inexistente")).toBe(false);
  });
  it("defesa: sequencial com linha PENDENTE fora de ordem não assina", () => {
    expect(podeAssinarAgora("SEQUENCIAL", mk(["AGUARDANDO", "PENDENTE"]), "s1")).toBe(false);
  });
  it("promoção do próximo e conclusão", () => {
    expect(proximosAPromover("SEQUENCIAL", mk(["ASSINADO", "AGUARDANDO", "AGUARDANDO"]))).toEqual(["s1"]);
    expect(proximosAPromover("SEQUENCIAL", mk(["ASSINADO", "PENDENTE", "AGUARDANDO"]))).toEqual([]);
    expect(proximosAPromover("SEQUENCIAL", mk(["ASSINADO", "ASSINADO", "ASSINADO"]))).toEqual([]);
    expect(proximosAPromover("PARALELO", mk(["ASSINADO", "AGUARDANDO"]))).toEqual([]);
    expect(todosAssinaram(mk(["ASSINADO", "ASSINADO"]))).toBe(true);
    expect(todosAssinaram(mk(["ASSINADO", "PENDENTE"]))).toBe(false);
    expect(todosAssinaram([])).toBe(false);
    expect(daVez(mk(["ASSINADO", "PENDENTE", "AGUARDANDO"]))?.id).toBe("s1");
  });
});

describe("transições de estado", () => {
  it("solicitação ABERTA é o único estado de origem", () => {
    for (const para of ["CONCLUIDA", "RECUSADA", "CANCELADA", "EXPIRADA"] as const) expect(podeTransitarSolicitacao("ABERTA", para)).toBe(true);
    for (const de of ["CONCLUIDA", "RECUSADA", "CANCELADA", "EXPIRADA"] as const) for (const para of ["ABERTA", "CONCLUIDA", "RECUSADA"] as const) expect(podeTransitarSolicitacao(de, para)).toBe(false);
  });
  it("assinante: ASSINADO e RECUSADO são finais", () => {
    expect(podeTransitarAssinante("AGUARDANDO", "PENDENTE")).toBe(true);
    expect(podeTransitarAssinante("PENDENTE", "ASSINADO")).toBe(true);
    expect(podeTransitarAssinante("AGUARDANDO", "ASSINADO")).toBe(false);
    expect(podeTransitarAssinante("ASSINADO", "PENDENTE")).toBe(false);
    expect(podeTransitarAssinante("RECUSADO", "PENDENTE")).toBe(false);
  });
  it("status do documento", () => {
    expect(podeSolicitarNoStatus("PUBLICADO")).toBe(true);
    expect(podeSolicitarNoStatus("RECUSADO")).toBe(true);
    expect(podeSolicitarNoStatus("EM_ASSINATURA")).toBe(false);
    expect(podeSolicitarNoStatus("ASSINADO")).toBe(false);
    expect(podeSolicitarNoStatus("ARQUIVADO")).toBe(false);
    expect(statusDocumentoAposEncerrar("RECUSADA")).toBe("RECUSADO");
    expect(statusDocumentoAposEncerrar("EXPIRADA")).toBe("PUBLICADO");
    expect(statusDocumentoAposEncerrar("CANCELADA")).toBe("PUBLICADO");
    expect(statusDocumentoAposEncerrar("CONCLUIDA")).toBe("ASSINADO");
    expect(statusDocumentoAposEncerrar("ABERTA")).toBeNull();
  });
});

describe("prazo e lembretes (Brasília)", () => {
  it("prazo vai até 23:59:59 de Brasília do dia N", () => {
    const p = calcularPrazoAssinatura(new Date("2026-10-07T01:00:00Z"), 15); // 06/10 22:00 em Brasília
    expect(fmtDataHoraBrasilia(p)).toBe("21/10/2026 23:59");
    expect(prazoExpirado(p, new Date(p.getTime() + 1))).toBe(true);
    expect(prazoExpirado(p, p)).toBe(false);
  });
  it("dias civis e formatação", () => {
    expect(diasCivisEntre(new Date("2026-10-07T12:00:00Z"), new Date("2026-10-10T20:00:00Z"))).toBe(3);
    expect(fmtDataHoraBrasilia(new Date("2026-01-02T02:30:00Z"))).toBe("01/01/2026 23:30");
    expect(fmtDataHoraBrasilia(null)).toBe("—");
  });
  const prazo = new Date("2026-10-20T02:59:59.999Z"); // fim de 19/10 em Brasília
  const base = { prazo_em: prazo, criada_em: new Date("2026-10-01T12:00:00Z"), lembrete_dias: [3, 1, 0] };
  it("D-3, D-1 e D0 disparam uma vez cada (ultimo_lembrete_em evita repetir)", () => {
    const d3 = new Date("2026-10-16T12:00:00Z"); // 16/10 09:00
    expect(lembreteDevido({ ...base, agora: d3, ultimo_lembrete_em: null })).toBe(true);
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-16T15:00:00Z"), ultimo_lembrete_em: d3 })).toBe(false);
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-17T12:00:00Z"), ultimo_lembrete_em: d3 })).toBe(false); // D-2
    const d1 = new Date("2026-10-18T12:00:00Z");
    expect(lembreteDevido({ ...base, agora: d1, ultimo_lembrete_em: d3 })).toBe(true);
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-18T14:00:00Z"), ultimo_lembrete_em: d1 })).toBe(false);
    const d0 = new Date("2026-10-19T12:00:00Z");
    expect(lembreteDevido({ ...base, agora: d0, ultimo_lembrete_em: d1 })).toBe(true);
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-19T20:00:00Z"), ultimo_lembrete_em: d0 })).toBe(false);
  });
  it("não envia antes do primeiro limiar, fora da janela 8h–20h, nem depois do prazo", () => {
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-10T12:00:00Z"), ultimo_lembrete_em: null })).toBe(false); // D-9
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-16T05:00:00Z"), ultimo_lembrete_em: null })).toBe(false); // 02:00 BRT
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-16T23:30:00Z"), ultimo_lembrete_em: null })).toBe(false); // 20:30 BRT
    expect(lembreteDevido({ ...base, agora: new Date("2026-10-20T12:00:00Z"), ultimo_lembrete_em: null })).toBe(false);
  });
  it("solicitação criada já dentro do limiar não dispara lembrete imediato", () => {
    const criada = new Date("2026-10-17T12:00:00Z"); // D-2
    expect(lembreteDevido({ ...base, criada_em: criada, agora: new Date("2026-10-17T13:00:00Z"), ultimo_lembrete_em: null })).toBe(false);
    expect(lembreteDevido({ ...base, criada_em: criada, agora: new Date("2026-10-18T12:00:00Z"), ultimo_lembrete_em: null })).toBe(true); // D-1
  });
  it("lembrete_dias personalizado", () => {
    expect(lembreteDevido({ ...base, lembrete_dias: [7], agora: new Date("2026-10-12T12:00:00Z"), ultimo_lembrete_em: null })).toBe(true);
    expect(lembreteDevido({ ...base, lembrete_dias: [], agora: new Date("2026-10-18T12:00:00Z"), ultimo_lembrete_em: null })).toBe(false);
  });
});

describe("código verificador, URL e rodapé", () => {
  it("formato e normalização", () => {
    for (let i = 0; i < 50; i++) expect(ehCodigoVerificador(gerarCodigoVerificador())).toBe(true);
    expect(ehCodigoVerificador("abcd-efgh-jklm")).toBe(false);
    expect(ehCodigoVerificador("AAAA-BBBB-CCC0")).toBe(false);
    expect(normalizarCodigoGed("abcd efgh jkLm")).toBe("ABCD-EFGH-JKLM");
    expect(normalizarCodigoGed("ABCD-EFGH-JKL")).toBeNull();
    expect(normalizarCodigoGed("ABCD-EFGH-JKL1")).toBeNull();
    expect(normalizarCodigoGed(null)).toBeNull();
  });
  it("URL e texto do rodapé (sem caracteres fora do Latin-1)", () => {
    const url = urlVerificacao("ABCD-EFGH-JKLM", "https://ged.exemplo.test/");
    expect(url).toBe("https://ged.exemplo.test/verificar/ABCD-EFGH-JKLM");
    const t = textoRodapeSelo("ABCD-EFGH-JKLM", url);
    expect(t.codigo).toContain("ABCD-EFGH-JKLM");
    expect(t.linha2).toContain("ged.exemplo.test/verificar");
    expect(/^[\x20-\xff]*$/.test(t.linha1 + t.linha2 + t.codigo)).toBe(true);
  });
});

describe("folha de assinaturas", () => {
  const dados: DadosFolha = {
    organizacao: { nome: "Câmara <b>Demo</b>", logo_data_uri: null },
    numero: "CMVA-DOC-2026-000001", titulo: "Contrato \"X\" & Cia", versao_n: 2, paginas_documento: 3, sha256_alvo: ALVO, modo: "SEQUENCIAL",
    solicitado_por: "Ana Autora", solicitada_em: new Date("2026-10-07T12:00:00Z"), selado_em: new Date("2026-10-08T15:30:00Z"),
    codigo: "ABCD-EFGH-JKLM", url: "https://x.test/verificar/ABCD-EFGH-JKLM", qr_data_uri: "data:image/png;base64,AAAA",
    assinantes: [{ ordem: 1, nome: "Bruno <script>", cargo: "Diretor", assinado_em: new Date("2026-10-08T14:00:00Z"), metodo: "ELETRONICA_AVANCADA", hash_cadeia: "f".repeat(64), rotulo: "Assinar" }],
    certificado: null,
  };
  it("traz código, URL, hash, horário de Brasília e escapa HTML", () => {
    const h = htmlFolhaAssinaturas(dados);
    expect(h).toContain("ABCD-EFGH-JKLM");
    expect(h).toContain("https://x.test/verificar/ABCD-EFGH-JKLM");
    expect(h).toContain(ALVO);
    expect(h).toContain("f".repeat(64));
    expect(h).toContain("08/10/2026 11:00");
    expect(h).toContain("08/10/2026 12:30");
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<b>Demo</b>");
    expect(h).toContain("assinatura eletrônica avançada");
  });
  it("com certificado mostra o selo PAdES; certificado de teste é sinalizado", () => {
    const h = htmlFolhaAssinaturas({ ...dados, certificado: { titular: "ORGAO TESTE", emissor: "AC TESTE", serial: "01AB", valido_ate: new Date("2027-01-01T12:00:00Z"), teste: true } });
    expect(h).toContain("Selo digital PAdES");
    expect(h).toContain("ORGAO TESTE");
    expect(h).toContain("TESTE, sem valor legal");
    expect(h).not.toContain("sem certificado digital ICP-Brasil do órgão");
  });
});

describe("validação de entradas", () => {
  const base = { documento_id: "11111111-1111-4111-8111-111111111111", signatarios: [U[0], U[1]], modo: "SEQUENCIAL" };
  it("solicitar", () => {
    expect(zSolicitarAssinatura.parse(base).modo).toBe("SEQUENCIAL");
    expect(() => zSolicitarAssinatura.parse({ ...base, signatarios: [] })).toThrow();
    expect(() => zSolicitarAssinatura.parse({ ...base, signatarios: [U[0], U[0]] })).toThrow();
    expect(() => zSolicitarAssinatura.parse({ ...base, prazo_dias: 0 })).toThrow();
    expect(() => zSolicitarAssinatura.parse({ ...base, prazo_dias: 91 })).toThrow();
    expect(zSolicitarAssinatura.parse({ ...base, prazo_dias: "10", mensagem: "  " }).mensagem).toBeUndefined();
    expect(() => zSolicitarAssinatura.parse({ ...base, modo: "X" })).toThrow();
  });
  it("recusar exige justificativa de 10+ caracteres; assinar exige consentimento", () => {
    expect(() => zRecusar.parse({ solicitacao_id: U[0], justificativa: "curta" })).toThrow();
    expect(zRecusar.parse({ solicitacao_id: U[0], justificativa: "  motivo suficiente  " }).justificativa).toBe("motivo suficiente");
    expect(() => zAssinar.parse({ solicitacao_id: U[0], senha: "x", consentimento: false })).toThrow();
    expect(() => zAssinar.parse({ solicitacao_id: U[0], senha: "", consentimento: true })).toThrow();
    expect(zAssinar.parse({ solicitacao_id: U[0], senha: "x", consentimento: true }).consentimento).toBe(true);
  });
});

describe("rodapé do PDF (QR em todas as páginas)", () => {
  it("geometria por rotação", () => {
    expect(visualParaNativo(0, 600, 800, 10, 20)).toEqual({ x: 10, y: 20, angulo: 0 });
    expect(visualParaNativo(90, 600, 800, 10, 20)).toEqual({ x: 580, y: 10, angulo: 90 });
    expect(visualParaNativo(180, 600, 800, 10, 20)).toEqual({ x: 590, y: 780, angulo: 180 });
    expect(visualParaNativo(270, 600, 800, 10, 20)).toEqual({ x: 20, y: 790, angulo: 270 });
    expect(visualParaNativo(-90, 600, 800, 10, 20).angulo).toBe(270);
  });
  async function pdfDe(paginas: number, rot: number[] = []) {
    const d = await PDFDocument.create();
    for (let i = 0; i < paginas; i++) {
      const p = d.addPage([595, 842]);
      p.drawText(`Página ${i + 1}`, { x: 50, y: 700 });
      if (rot[i]) p.setRotation(degrees(rot[i]));
    }
    return Buffer.from(await d.save());
  }
  it("estampa o QR e o código em TODAS as páginas, inclusive rotacionadas, e anexa a folha", async () => {
    const orig = await pdfDe(4, [0, 90, 180, 270]);
    const r = await estamparRodape(orig, { codigo: "ABCD-EFGH-JKLM", url: "https://x.test/verificar/ABCD-EFGH-JKLM" });
    expect(r.paginas).toBe(4);
    const doc = await PDFDocument.load(r.pdf);
    expect(doc.getPageCount()).toBe(4);
    for (const pg of doc.getPages()) {
      const xobj = pg.node.Resources()?.lookup(pg.node.context.obj("XObject") as never);
      expect(xobj).toBeDefined(); // a imagem do QR foi referenciada na página
    }
    expect(r.pdf.equals(orig)).toBe(false);
    const folha = await pdfDe(1);
    const unido = await anexarPaginas(r.pdf, folha);
    expect(unido.paginas).toBe(5);
  });
  it("PDF inválido vira erro amigável (422)", async () => {
    await expect(estamparRodape(Buffer.from("não é pdf"), { codigo: "ABCD-EFGH-JKLM", url: "https://x.test/verificar/ABCD-EFGH-JKLM" })).rejects.toMatchObject({ status: 422 });
  });
});
