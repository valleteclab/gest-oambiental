import { describe, expect, it } from "vitest";
import {
  chaveDedup, codigoOptin, conferirCodigoOptin, erroComTentativa, esperaTentativaMs, EVENTOS_CONFIGURAVEIS, filtrarDestinatarios, lerPendente, mascararEmail,
  OPTIN_MAX_TENTATIVAS, OPTIN_VALIDADE_MS, planejarCanais, PREFERENCIA_PADRAO, resolverPreferencia, semPrefixoTentativa, serializarPendente, tentativasDoErro,
  type MembroNotificavel,
} from "@/lib/ged/notificar/regras";
import {
  assuntoEvento, dataHoraBrasilia, escHtml, linhaEnviadoEm, linkDoEvento, nomeDocumento, renderEmail, renderWhatsapp, type ContextoTemplate,
} from "@/lib/ged/templates";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

const membro = (id: string, o: Partial<MembroNotificavel> = {}): MembroNotificavel => ({
  usuario_id: id, membro_ativo: true, usuario_ativo: true, usuario_organizacao_id: ORG, email: `${id.slice(0, 2)}@x.test`, tem_telefone: false, whatsapp_optin_em: null, ...o,
});

describe("preferências", () => {
  it("padrão: e-mail ligado, WhatsApp desligado", () => {
    expect(PREFERENCIA_PADRAO).toEqual({ email: true, whatsapp: false });
    expect(resolverPreferencia(undefined)).toEqual({ email: true, whatsapp: false });
    expect(resolverPreferencia(null)).toEqual({ email: true, whatsapp: false });
  });
  it("registro parcial/total sobrepõe o padrão", () => {
    expect(resolverPreferencia({ email: false })).toEqual({ email: false, whatsapp: false });
    expect(resolverPreferencia({ email: false, whatsapp: true })).toEqual({ email: false, whatsapp: true });
  });
  it("oito eventos configuráveis (inclui cancelamento de assinatura)", () => {
    expect(EVENTOS_CONFIGURAVEIS).toHaveLength(8);
    expect(EVENTOS_CONFIGURAVEIS).toContain("ASSINATURA_CANCELADA");
    expect(EVENTOS_CONFIGURAVEIS).not.toContain("CONFIRMACAO_WHATSAPP" as never);
  });
});

describe("destinatários", () => {
  it("ignora ids de outro cliente, inativos e desconhecidos; sem repetição", () => {
    const lista = [
      membro(U1),
      membro(U2, { usuario_organizacao_id: OUTRA }),
      membro(U3, { membro_ativo: false }),
      membro("44444444-4444-4444-8444-444444444444", { usuario_ativo: false }),
      membro("55555555-5555-4555-8555-555555555555", { usuario_organizacao_id: null }),
    ];
    const r = filtrarDestinatarios([U1, U1, U2, U3, "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"], lista, ORG);
    expect(r.map((m) => m.usuario_id)).toEqual([U1]);
  });
});

describe("planejarCanais", () => {
  const confirmado = membro(U1, { tem_telefone: true, whatsapp_optin_em: new Date() });
  it("e-mail por padrão", () => expect(planejarCanais(membro(U1), PREFERENCIA_PADRAO, true)).toEqual(["EMAIL"]));
  it("e-mail desligado e sem WhatsApp: nenhuma linha", () => expect(planejarCanais(membro(U1), { email: false, whatsapp: false }, true)).toEqual([]));
  it("WhatsApp exige preferência + telefone + opt-in + canal configurado", () => {
    const p = { email: true, whatsapp: true };
    expect(planejarCanais(confirmado, p, true)).toEqual(["EMAIL", "WHATSAPP"]);
    expect(planejarCanais(confirmado, p, false)).toEqual(["EMAIL"]);
    expect(planejarCanais({ ...confirmado, whatsapp_optin_em: null }, p, true)).toEqual(["EMAIL"]);
    expect(planejarCanais({ ...confirmado, tem_telefone: false }, p, true)).toEqual(["EMAIL"]);
    expect(planejarCanais(confirmado, { email: true, whatsapp: false }, true)).toEqual(["EMAIL"]);
  });
  it("sem e-mail cadastrado não há linha de e-mail", () => expect(planejarCanais(membro(U1, { email: null }), PREFERENCIA_PADRAO, true)).toEqual([]));
});

describe("deduplicação, máscara e tentativas", () => {
  it("chave de dedup distingue usuário, evento, documento e canal", () => {
    const a = chaveDedup(U1, "TRAMITE_RECEBIDO", "d1", "EMAIL");
    expect(a).toBe(chaveDedup(U1, "TRAMITE_RECEBIDO", "d1", "EMAIL"));
    expect(a).not.toBe(chaveDedup(U2, "TRAMITE_RECEBIDO", "d1", "EMAIL"));
    expect(a).not.toBe(chaveDedup(U1, "ASSINATURA_LEMBRETE", "d1", "EMAIL"));
    expect(a).not.toBe(chaveDedup(U1, "TRAMITE_RECEBIDO", "d2", "EMAIL"));
    expect(a).not.toBe(chaveDedup(U1, "TRAMITE_RECEBIDO", "d1", "WHATSAPP"));
    expect(chaveDedup(U1, "X", null, "EMAIL")).toBe(chaveDedup(U1, "X", undefined, "EMAIL"));
  });
  it("mascara e-mail", () => {
    expect(mascararEmail("maria.silva@camara.gov.br")).toBe("m***@camara.gov.br");
    expect(mascararEmail("sem-arroba")).toBe("***");
  });
  it("tentativas: prefixo [tN] e backoff crescente com teto", () => {
    expect(tentativasDoErro(null)).toBe(0);
    expect(tentativasDoErro("falha qualquer")).toBe(0);
    expect(tentativasDoErro(erroComTentativa(2, "timeout"))).toBe(2);
    expect(semPrefixoTentativa(erroComTentativa(2, "timeout"))).toBe("timeout");
    expect(esperaTentativaMs(0)).toBe(0);
    expect(esperaTentativaMs(2)).toBeGreaterThan(esperaTentativaMs(1));
    expect(esperaTentativaMs(50)).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe("código de confirmação do WhatsApp", () => {
  const chave = "chave-do-servidor";
  const base = new Date("2026-10-07T12:00:00Z");
  const pend = (o: Partial<{ t: number; exp: number }> = {}) => ({ tel: "5575999998888", cid: "cid-1", exp: base.getTime() + OPTIN_VALIDADE_MS, t: 0, ...o });
  it("código tem 6 dígitos, é determinístico e depende de comunicação/usuário/telefone/chave", () => {
    const c = codigoOptin(chave, "cid-1", U1, "5575999998888");
    expect(c).toMatch(/^\d{6}$/);
    expect(codigoOptin(chave, "cid-1", U1, "5575999998888")).toBe(c);
    expect(codigoOptin(chave, "cid-2", U1, "5575999998888")).not.toBe(c);
    expect(codigoOptin(chave, "cid-1", U2, "5575999998888")).not.toBe(c);
    expect(codigoOptin("outra", "cid-1", U1, "5575999998888")).not.toBe(c);
  });
  it("aceita o código correto (com espaços/hífen) dentro da validade", () => {
    const c = codigoOptin(chave, "cid-1", U1, "5575999998888");
    expect(conferirCodigoOptin(pend(), c, U1, chave, base)).toEqual({ ok: true });
    expect(conferirCodigoOptin(pend(), `${c.slice(0, 3)} - ${c.slice(3)}`, U1, chave, base)).toEqual({ ok: true });
  });
  it("recusa expirado, incorreto (conta tentativa), formato e excesso de tentativas", () => {
    const c = codigoOptin(chave, "cid-1", U1, "5575999998888");
    expect(conferirCodigoOptin(pend(), c, U1, chave, new Date(base.getTime() + OPTIN_VALIDADE_MS + 1000))).toMatchObject({ ok: false, motivo: "EXPIRADO" });
    const errado = c === "000000" ? "000001" : "000000";
    expect(conferirCodigoOptin(pend(), errado, U1, chave, base)).toEqual({ ok: false, motivo: "INCORRETO", tentativas: 1 });
    expect(conferirCodigoOptin(pend(), "12", U1, chave, base)).toMatchObject({ ok: false, motivo: "FORMATO" });
    expect(conferirCodigoOptin(pend({ t: OPTIN_MAX_TENTATIVAS }), c, U1, chave, base)).toMatchObject({ ok: false, motivo: "TENTATIVAS" });
  });
  it("outro usuário não confirma com o código alheio", () => {
    const c = codigoOptin(chave, "cid-1", U1, "5575999998888");
    expect(conferirCodigoOptin(pend(), c, U2, chave, base)).toMatchObject({ ok: false, motivo: "INCORRETO" });
  });
  it("serializa/lê a pendência; telefone simples não é pendência", () => {
    const p = pend();
    expect(lerPendente(serializarPendente(p))).toEqual(p);
    expect(lerPendente("5575999998888")).toBeNull();
    expect(lerPendente("{quebrado")).toBeNull();
    expect(lerPendente(null)).toBeNull();
    expect(serializarPendente(p)).not.toContain(codigoOptin("chave-do-servidor", p.cid, U1, p.tel)); // o código nunca é guardado
  });
});

// ───────────── Templates ─────────────

const DOC = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", numero: "CMVA-DOC-2026-000123", titulo: "Contrato <b>reservado</b> & cia", sensibilidade: "RESTRITO" as const };
const ctx = (o: Partial<ContextoTemplate> = {}): ContextoTemplate => ({
  evento: "TRAMITE_RECEBIDO", organizacao_nome: "Câmara de Vale das Acácias (DEMO)", destinatario_nome: "Maria da Silva", documento: DOC, app_url: "https://app.exemplo.test/", agora: new Date("2026-10-07T17:30:00Z"), ...o,
});

describe("data/hora de envio (Brasília)", () => {
  it("formata em America/Sao_Paulo no momento do envio", () => {
    expect(dataHoraBrasilia(new Date("2026-10-07T17:30:00Z"))).toBe("07/10/2026 às 14:30");
    expect(linhaEnviadoEm(new Date("2026-10-07T17:30:00Z"))).toBe("Enviado em 07/10/2026 às 14:30 (horário de Brasília)");
  });
  it("vira o dia pelo fuso (02:10 UTC = 23:10 do dia anterior) e usa 24h", () => {
    expect(dataHoraBrasilia(new Date("2026-10-08T02:10:00Z"))).toBe("07/10/2026 às 23:10");
    expect(dataHoraBrasilia(new Date("2026-01-01T03:05:00Z"))).toBe("01/01/2026 às 00:05");
  });
  it("o e-mail usa o `agora` recebido (envio), não a data de criação", () => {
    const a = renderEmail(ctx({ agora: new Date("2026-10-07T17:30:00Z") }));
    const b = renderEmail(ctx({ agora: new Date("2026-10-09T12:00:00Z") }));
    expect(a.texto).toContain("Enviado em 07/10/2026 às 14:30 (horário de Brasília)");
    expect(a.html).toContain("Enviado em 07/10/2026 às 14:30 (horário de Brasília)");
    expect(b.texto).toContain("Enviado em 09/10/2026 às 09:00 (horário de Brasília)");
  });
});

describe("templates de e-mail", () => {
  it("escapa texto dinâmico (título, nome, órgão, remetente)", () => {
    const r = renderEmail(ctx({ destinatario_nome: "<script>alert(1)</script>", organizacao_nome: 'Órgão "X" & Y', remetente_nome: "<img src=x onerror=1>" }));
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("Órgão &quot;X&quot; &amp; Y");
    expect(r.html).toContain("Contrato &lt;b&gt;reservado&lt;/b&gt; &amp; cia");
  });
  it("título aparece só se não for SIGILOSO", () => {
    expect(renderEmail(ctx()).texto).toContain("Contrato");
    const s = renderEmail(ctx({ documento: { ...DOC, sensibilidade: "SIGILOSO" } }));
    expect(s.texto).not.toContain("Contrato");
    expect(s.html).not.toContain("reservado");
    expect(s.texto).toContain(DOC.numero);
    expect(renderWhatsapp(ctx({ documento: { ...DOC, sensibilidade: "SIGILOSO" } }))).not.toContain("Contrato");
    expect(renderWhatsapp(ctx())).toContain("Contrato");
  });
  it("assunto nunca leva o título (só o número)", () => {
    for (const e of EVENTOS_CONFIGURAVEIS) expect(assuntoEvento(e, DOC.numero)).toContain(DOC.numero);
    expect(renderEmail(ctx()).assunto).not.toContain("Contrato");
  });
  it("link: documento ou lista de assinaturas, sem barra dupla", () => {
    expect(linkDoEvento(ctx())).toBe(`https://app.exemplo.test/ged/documentos/${DOC.id}`);
    expect(linkDoEvento(ctx({ evento: "ASSINATURA_SOLICITADA" }))).toBe("https://app.exemplo.test/ged/assinaturas");
    expect(linkDoEvento(ctx({ evento: "ASSINATURA_LEMBRETE" }))).toBe("https://app.exemplo.test/ged/assinaturas");
    expect(linkDoEvento(ctx({ documento: null }))).toBe("https://app.exemplo.test/ged/assinaturas");
    expect(renderEmail(ctx({ evento: "DOCUMENTO_COMPARTILHADO" })).html).toContain(`href="https://app.exemplo.test/ged/documentos/${DOC.id}"`);
  });
  it("todos os eventos geram assunto, ação necessária, número e link (sem anexos)", () => {
    for (const evento of EVENTOS_CONFIGURAVEIS) {
      const r = renderEmail(ctx({ evento, prazo_em: new Date("2026-10-20T15:00:00Z") }));
      expect(r.assunto.length).toBeGreaterThan(5);
      expect(r.texto).toContain("Ação necessária");
      expect(r.texto).toContain("https://app.exemplo.test/ged/");
      expect(r.html).not.toMatch(/<attachment|Content-Disposition/i);
    }
    expect(renderEmail(ctx({ evento: "ASSINATURA_SOLICITADA", prazo_em: new Date("2026-10-20T15:00:00Z") })).texto).toContain("até 20/10/2026");
  });
  it("saudação usa o primeiro nome; sem nome não quebra", () => {
    expect(renderEmail(ctx()).texto).toContain("Olá, Maria.");
    expect(renderEmail(ctx({ destinatario_nome: "  " })).texto).toContain("Olá, tudo bem.");
  });
});

describe("templates de WhatsApp", () => {
  it("curto, com link e data/hora de envio", () => {
    const t = renderWhatsapp(ctx());
    expect(t.length).toBeLessThan(600);
    expect(t).toContain("https://app.exemplo.test/ged/documentos/");
    expect(t).toContain("Enviado em 07/10/2026 às 14:30 (horário de Brasília)");
  });
  it("confirmação traz o código e não traz link de documento", () => {
    const t = renderWhatsapp(ctx({ evento: "CONFIRMACAO_WHATSAPP", documento: null, codigo: "123456" }));
    expect(t).toContain("123456");
    expect(t).not.toContain("/ged/documentos");
  });
});

describe("utilitários", () => {
  it("escHtml e nomeDocumento", () => {
    expect(escHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    expect(nomeDocumento(null)).toBe("um documento");
    expect(nomeDocumento({ ...DOC, sensibilidade: "SIGILOSO" })).toBe(`documento ${DOC.numero}`);
  });
});
