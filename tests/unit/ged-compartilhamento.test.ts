import { beforeEach, describe, expect, it } from "vitest";
import { ErroApi } from "@/lib/http";
import { _zerarLimites } from "@/lib/limite-login";
import { calcularConteudoPastas, pastaDoZip, type EscopoLink } from "@/lib/ged/compartilhamento/conteudo";
import { caminhosCookie, conexaoSegura, cookiesSessao, lerCookieSessao } from "@/lib/ged/compartilhamento/http";
import { esperaIpMs, exigirEnvioOtpPermitido, exigirIpSemBloqueioOtp, exigirVolumePermitido, registrarCodigoErradoIp, registrarTokenRuim } from "@/lib/ged/compartilhamento/limites";
import {
  bloqueioProgressivoMs, calcularExpiracao, conferirOtp, decidirEnvioOtp, documentoCompartilhavel, downloadsEsgotados, exigeConfirmacaoRestrito, gerarOtp, gerarSal, gerarToken, hashIp,
  hashOtp, hashToken, hashUserAgent, iguaisTempoConstante, linkVigente, mascararWhatsapp, motivosBloqueio, normalizarCodigoOtp, normalizarPermissoes, normalizarWhatsapp, OTP_MAX_ENVIOS_HORA,
  OTP_MAX_TENTATIVAS, OTP_VALIDADE_MS, renovarSessao, resolverValidadeDias, resumirUserAgent, SESSAO_DESLIZANTE_MS, SESSAO_TETO_MS, situacaoOtp, situacaoSessao, statusEfetivo, terminacaoWhatsapp,
  tetoDaSessao, tokenValido, truncarIp, whereCompartilhavel, zCriarCompartilhamento, type DocElegibilidade,
} from "@/lib/ged/compartilhamento/regras";
import { textoLink, textoOtp } from "@/lib/ged/compartilhamento/whatsapp";
import { podeCompartilhar, CAPACIDADES_POR_PAPEL } from "@/lib/ged/papeis";

// Compartilhamento externo por link + OTP no WhatsApp (docs/ged.md §18): regras PURAS, sem banco nem rede.
const AGORA = new Date("2026-10-12T12:00:00Z");
const mais = (ms: number) => new Date(AGORA.getTime() + ms);
const UUID = "11111111-1111-4111-8111-111111111111";

describe("token do link", () => {
  it("tem >= 32 bytes de entropia (43 caracteres base64url), é único e só o hash (sha256) é derivado", () => {
    const a = gerarToken();
    const b = gerarToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(tokenValido(a)).toBe(true);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
  it("recusa formatos fora do padrão (nem consulta o banco)", () => {
    for (const t of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`, `${"a".repeat(41)}..`, null, undefined, 42]) expect(tokenValido(t)).toBe(false);
  });
});

describe("OTP", () => {
  it("tem 6 dígitos numéricos (com zeros à esquerda) e usa o CSPRNG de forma uniforme o bastante", () => {
    const visto = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = gerarOtp();
      expect(c).toMatch(/^\d{6}$/);
      visto.add(c);
    }
    expect(visto.size).toBeGreaterThan(380); // praticamente sem repetição em 400 sorteios de 1.000.000
  });
  it("é guardado como hash com sal, preso ao link; confere em tempo constante", () => {
    const sal = gerarSal();
    const h = hashOtp("123456", sal, UUID);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(conferirOtp("123456", h, sal, UUID)).toBe(true);
    expect(conferirOtp("123457", h, sal, UUID)).toBe(false);
    expect(conferirOtp("123456", h, gerarSal(), UUID)).toBe(false); // outro sal
    expect(conferirOtp("123456", h, sal, "22222222-2222-4222-8222-222222222222")).toBe(false); // código de um link não vale em outro
    expect(gerarSal()).not.toBe(gerarSal());
  });
  it("comparação em tempo constante rejeita tamanhos diferentes sem lançar", () => {
    expect(iguaisTempoConstante("abc", "abc")).toBe(true);
    expect(iguaisTempoConstante("abc", "abcd")).toBe(false);
    expect(iguaisTempoConstante("", "")).toBe(true);
  });
  it("normaliza o código digitado (só dígitos, exatamente 6)", () => {
    expect(normalizarCodigoOtp("123 456")).toBe("123456");
    expect(normalizarCodigoOtp("12345")).toBeNull();
    expect(normalizarCodigoOtp("1234567")).toBeNull();
    expect(normalizarCodigoOtp("abcdef")).toBeNull();
    expect(normalizarCodigoOtp(null)).toBeNull();
  });
  it("situação: validade de 10 min, uso único, 5 tentativas, invalidado por novo envio", () => {
    expect(OTP_VALIDADE_MS).toBe(600_000);
    expect(OTP_MAX_TENTATIVAS).toBe(5);
    const base = { expira_em: mais(OTP_VALIDADE_MS), tentativas: 0, usado_em: null, invalidado_em: null };
    expect(situacaoOtp(base, AGORA)).toBe("VIGENTE");
    expect(situacaoOtp({ ...base, tentativas: 4 }, AGORA)).toBe("VIGENTE");
    expect(situacaoOtp({ ...base, tentativas: 5 }, AGORA)).toBe("SEM_TENTATIVAS");
    expect(situacaoOtp({ ...base, expira_em: AGORA }, AGORA)).toBe("EXPIRADO");
    expect(situacaoOtp({ ...base, expira_em: mais(-1) }, AGORA)).toBe("EXPIRADO");
    expect(situacaoOtp({ ...base, usado_em: AGORA }, AGORA)).toBe("USADO");
    expect(situacaoOtp({ ...base, invalidado_em: AGORA }, AGORA)).toBe("INVALIDADO");
  });
});

describe("reenvio e bloqueio", () => {
  it("intervalo mínimo de 60 s entre envios", () => {
    expect(decidirEnvioOtp([], AGORA)).toEqual({ ok: true });
    const r = decidirEnvioOtp([mais(-20_000)], AGORA);
    expect(r).toMatchObject({ ok: false, motivo: "INTERVALO", retry_after_s: 40 });
    expect(decidirEnvioOtp([mais(-60_000)], AGORA)).toEqual({ ok: true });
  });
  it("no máximo 5 envios por hora por link", () => {
    const envios = [50, 40, 30, 20, 10].map((m) => mais(-m * 60_000)); // 5 nos últimos 50 min, todos com folga de 60 s
    expect(OTP_MAX_ENVIOS_HORA).toBe(5);
    const r = decidirEnvioOtp(envios, AGORA);
    expect(r).toMatchObject({ ok: false, motivo: "LIMITE_HORA" });
    expect(r.ok === false && r.retry_after_s).toBe(10 * 60); // o mais antigo (50 min) sai da janela em 10 min
    expect(decidirEnvioOtp(envios.slice(1), AGORA)).toEqual({ ok: true }); // 4 na hora
    expect(decidirEnvioOtp([mais(-61 * 60_000), ...envios.slice(1)], AGORA)).toEqual({ ok: true }); // envio com mais de 1 h não conta
  });
  it("bloqueio progressivo por falhas seguidas", () => {
    expect([0, 4].map(bloqueioProgressivoMs)).toEqual([0, 0]);
    expect(bloqueioProgressivoMs(5)).toBe(60_000);
    expect(bloqueioProgressivoMs(9)).toBe(60_000);
    expect(bloqueioProgressivoMs(10)).toBe(600_000);
    expect(bloqueioProgressivoMs(15)).toBe(3_600_000);
    expect(bloqueioProgressivoMs(20)).toBe(86_400_000);
    expect(bloqueioProgressivoMs(500)).toBe(86_400_000);
    expect(esperaIpMs(4)).toBe(0);
    expect(esperaIpMs(5)).toBe(60_000);
    expect(esperaIpMs(20)).toBe(3_600_000);
  });
});

describe("mascaramento e minimização de dados", () => {
  it("normaliza o WhatsApp (celular brasileiro com DDD) e recusa o resto", () => {
    expect(normalizarWhatsapp("(75) 99999-8888")).toBe("5575999998888");
    expect(normalizarWhatsapp("+55 75 99999-8888")).toBe("5575999998888");
    expect(normalizarWhatsapp("75 9999-8888")).toBe("5575999998888"); // acrescenta o 9
    for (const ruim of ["", "123", "(75) 3333-4444", "(00) 99999-8888", "abc", null, undefined, 5575999998888]) expect(normalizarWhatsapp(ruim)).toBeNull();
  });
  it("mascara o número: quem compartilha vê (75) 9****-8888; o destinatário vê só ••88", () => {
    expect(mascararWhatsapp("5575999998888")).toBe("(75) 9****-8888");
    expect(mascararWhatsapp("5575999998888")).not.toContain("99999");
    expect(terminacaoWhatsapp("5575999998812")).toBe("••12");
    expect(terminacaoWhatsapp("5575999998812")).not.toContain("9999");
  });
  it("trunca o IP e resume o navegador (sem a cadeia completa)", () => {
    expect(truncarIp("203.0.113.77")).toBe("203.0.113.0");
    expect(truncarIp("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::");
    expect(truncarIp("desconhecido")).toBeNull();
    expect(truncarIp(null)).toBeNull();
    expect(hashIp("203.0.113.77")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp("203.0.113.77")).not.toContain("203");
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    expect(resumirUserAgent(chrome)).toBe("Chrome em Windows");
    expect(resumirUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile Safari/604.1")).toBe("Safari em iOS");
    expect(resumirUserAgent(null)).toBeNull();
    expect(hashUserAgent(chrome)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("a mensagem do código segue o texto combinado e o link não leva o código", () => {
    expect(textoOtp("Câmara de Teste", "123456")).toBe("Seu código para acessar documentos compartilhados por Câmara de Teste: 123456. Válido por 10 minutos. Não compartilhe.");
    const t = textoLink("Câmara de Teste", "Ana", "Ata 12", "https://x.test/compartilhado/abc");
    expect(t).toContain("https://x.test/compartilhado/abc");
    expect(t).not.toMatch(/\b\d{6}\b/);
  });
});

describe("validade", () => {
  it("padrão 7 dias, teto 30 (e o teto do cliente, se menor)", () => {
    expect(resolverValidadeDias(undefined)).toBe(7);
    expect(resolverValidadeDias(null)).toBe(7);
    expect(resolverValidadeDias(10)).toBe(10);
    expect(resolverValidadeDias(99)).toBe(30);
    expect(resolverValidadeDias(0)).toBe(1);
    expect(resolverValidadeDias(undefined, { padrao: 3, maximo: 5 })).toBe(3);
    expect(resolverValidadeDias(20, { padrao: 3, maximo: 5 })).toBe(5);
    expect(resolverValidadeDias(20, { padrao: 3, maximo: 90 })).toBe(20); // nunca acima de 30, mesmo que o cliente peça mais
    expect(resolverValidadeDias(40, { padrao: 3, maximo: 90 })).toBe(30);
    expect(resolverValidadeDias(undefined, { padrao: 20, maximo: 10 })).toBe(10); // padrão acima do teto é cortado
  });
  it("link vigente = ATIVO e dentro da validade; ATIVO vencido aparece como EXPIRADO", () => {
    expect(calcularExpiracao(AGORA, 7).getTime() - AGORA.getTime()).toBe(7 * 86_400_000);
    expect(linkVigente({ status: "ATIVO", expira_em: mais(1000) }, AGORA)).toBe(true);
    expect(linkVigente({ status: "ATIVO", expira_em: AGORA }, AGORA)).toBe(false);
    expect(linkVigente({ status: "REVOGADO", expira_em: mais(1000) }, AGORA)).toBe(false);
    expect(linkVigente({ status: "EXPIRADO", expira_em: mais(1000) }, AGORA)).toBe(false);
    expect(statusEfetivo({ status: "ATIVO", expira_em: mais(-1) }, AGORA)).toBe("EXPIRADO");
    expect(statusEfetivo({ status: "REVOGADO", expira_em: mais(-1) }, AGORA)).toBe("REVOGADO");
    expect(statusEfetivo({ status: "ATIVO", expira_em: mais(1) }, AGORA)).toBe("ATIVO");
  });
  it("limite de downloads", () => {
    expect(downloadsEsgotados({ limite_downloads: null, downloads: 999 })).toBe(false);
    expect(downloadsEsgotados({ limite_downloads: 3, downloads: 2 })).toBe(false);
    expect(downloadsEsgotados({ limite_downloads: 3, downloads: 3 })).toBe(true);
  });
});

describe("elegibilidade (o que nunca/só com confirmação se compartilha)", () => {
  const ok: DocElegibilidade = { sensibilidade: "PUBLICO", contem_dados_pessoais: false, anonimizacao_status: "NAO_NECESSARIA", documento_original_id: null, status: "PUBLICADO", excluido_em: null };
  it("documento comum é compartilhável; RESTRITO exige confirmação explícita", () => {
    expect(motivosBloqueio(ok)).toEqual([]);
    expect(documentoCompartilhavel({ ...ok, sensibilidade: "RESTRITO" })).toBe(true);
    expect(exigeConfirmacaoRestrito("RESTRITO")).toBe(true);
    expect(exigeConfirmacaoRestrito("PUBLICO")).toBe(false);
  });
  it("SIGILOSO NUNCA, em qualquer status", () => {
    for (const status of ["RASCUNHO", "PUBLICADO", "ASSINADO", "EM_ASSINATURA"] as const) expect(motivosBloqueio({ ...ok, sensibilidade: "SIGILOSO", status })).toContain("SIGILOSO");
  });
  it("dados pessoais / anonimização: só o derivado anonimizado sai; na dúvida bloqueia", () => {
    expect(motivosBloqueio({ ...ok, anonimizacao_status: "PENDENTE", contem_dados_pessoais: true })).toEqual(["ANONIMIZACAO_PENDENTE"]);
    expect(motivosBloqueio({ ...ok, anonimizacao_status: "PENDENTE" })).toEqual(["ANONIMIZACAO_PENDENTE"]);
    expect(motivosBloqueio({ ...ok, contem_dados_pessoais: true })).toEqual(["DADOS_PESSOAIS"]);
    expect(motivosBloqueio({ ...ok, anonimizacao_status: "ANONIMIZADA" })).toEqual(["DADOS_PESSOAIS"]); // o ORIGINAL de um anonimizado não sai
    expect(motivosBloqueio({ ...ok, anonimizacao_status: "ANONIMIZADA", documento_original_id: UUID })).toEqual([]); // o derivado anonimizado sai
    expect(motivosBloqueio({ ...ok, documento_original_id: UUID, contem_dados_pessoais: true })).toEqual(["DADOS_PESSOAIS"]);
  });
  it("excluído e arquivado ficam de fora", () => {
    expect(motivosBloqueio({ ...ok, excluido_em: AGORA })).toContain("EXCLUIDO");
    expect(motivosBloqueio({ ...ok, status: "ARQUIVADO" })).toContain("ARQUIVADO");
  });
  it("o filtro Prisma espelha as regras (sigiloso, dados pessoais, anonimização pendente, excluído, arquivado)", () => {
    const w = whereCompartilhavel();
    expect(w).toMatchObject({ excluido_em: null, status: { not: "ARQUIVADO" }, sensibilidade: { not: "SIGILOSO" }, anonimizacao_status: { not: "PENDENTE" }, contem_dados_pessoais: false });
    expect(JSON.stringify(w.OR)).toContain("NAO_NECESSARIA");
  });
});

describe("permissões do link", () => {
  it("exige ao menos ver ou baixar; ZIP exige baixar e só vale para pasta", () => {
    expect(normalizarPermissoes({}, "DOCUMENTO")).toEqual({ pode_visualizar: true, pode_baixar: false, pode_zip: false });
    expect(normalizarPermissoes({ pode_visualizar: false, pode_baixar: false }, "DOCUMENTO")).toHaveProperty("erro");
    expect(normalizarPermissoes({ pode_baixar: false, pode_zip: true }, "PASTA")).toHaveProperty("erro");
    expect(normalizarPermissoes({ pode_baixar: true, pode_zip: true }, "DOCUMENTO")).toHaveProperty("erro");
    expect(normalizarPermissoes({ pode_baixar: true, pode_zip: true }, "PASTA")).toEqual({ pode_visualizar: true, pode_baixar: true, pode_zip: true });
    expect(normalizarPermissoes({ pode_visualizar: false, pode_baixar: true }, "DOCUMENTO")).toEqual({ pode_visualizar: false, pode_baixar: true, pode_zip: false });
  });
  it("capacidade compartilhar: Admin, Gestor e Usuário; nunca Leitor nem Auditor", () => {
    expect(CAPACIDADES_POR_PAPEL.compartilhar).toEqual(["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"]);
    for (const papel of ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"] as const) expect(podeCompartilhar({ membro: { papel } })).toBe(true);
    for (const papel of ["GED_LEITOR", "GED_AUDITOR"] as const) expect(podeCompartilhar({ membro: { papel } })).toBe(false);
  });
});

describe("entrada da API (zod)", () => {
  const base = { recurso: { tipo: "documento", id: UUID }, whatsapp: "(75) 99999-8888" };
  it("aceita o mínimo e aplica os padrões", () => {
    const r = zCriarCompartilhamento.parse(base);
    expect(r).toMatchObject({ pode_visualizar: true, pode_baixar: false, pode_zip: false, confirmar_restrito: false, congelar: false, enviar_link_whatsapp: false });
    expect(r.validade_dias).toBeUndefined();
    expect(r.limite_downloads).toBeUndefined();
  });
  it("converte strings de formulário e campos vazios", () => {
    const r = zCriarCompartilhamento.parse({ ...base, validade_dias: "10", limite_downloads: "", destinatario_nome: "", pode_baixar: "on", mensagem: " oi " });
    expect(r.validade_dias).toBe(10);
    expect(r.limite_downloads).toBeUndefined();
    expect(r.destinatario_nome).toBeUndefined();
    expect(r.pode_baixar).toBe(true);
    expect(r.mensagem).toBe("oi");
  });
  it("recusa validade > 30, id inválido, campo desconhecido e WhatsApp ausente", () => {
    expect(zCriarCompartilhamento.safeParse({ ...base, validade_dias: 31 }).success).toBe(false);
    expect(zCriarCompartilhamento.safeParse({ ...base, validade_dias: 0 }).success).toBe(false);
    expect(zCriarCompartilhamento.safeParse({ ...base, recurso: { tipo: "documento", id: "x" } }).success).toBe(false);
    expect(zCriarCompartilhamento.safeParse({ ...base, organizacao_id: UUID }).success).toBe(false);
    expect(zCriarCompartilhamento.safeParse({ recurso: base.recurso }).success).toBe(false);
  });
});

describe("sessão do destinatário", () => {
  it("30 min deslizantes, teto absoluto de 2 h", () => {
    expect(SESSAO_DESLIZANTE_MS).toBe(30 * 60_000);
    expect(SESSAO_TETO_MS).toBe(2 * 3_600_000);
    const teto = tetoDaSessao(AGORA);
    expect(teto.getTime() - AGORA.getTime()).toBe(SESSAO_TETO_MS);
    expect(renovarSessao(AGORA, teto).getTime() - AGORA.getTime()).toBe(SESSAO_DESLIZANTE_MS);
    expect(renovarSessao(mais(100 * 60_000), teto).getTime()).toBe(teto.getTime()); // perto do teto: não passa dele
  });
  it("expirada, encerrada ou de outro navegador é recusada", () => {
    const ua = hashUserAgent("Chrome");
    const s = { expira_em: mais(60_000), teto_em: mais(3_600_000), encerrada_em: null, ua_hash: ua };
    expect(situacaoSessao(s, ua, AGORA)).toBe("OK");
    expect(situacaoSessao(s, hashUserAgent("Firefox"), AGORA)).toBe("NAVEGADOR_DIFERENTE");
    expect(situacaoSessao({ ...s, encerrada_em: AGORA }, ua, AGORA)).toBe("ENCERRADA");
    expect(situacaoSessao({ ...s, expira_em: AGORA }, ua, AGORA)).toBe("EXPIRADA");
    expect(situacaoSessao({ ...s, teto_em: AGORA }, ua, AGORA)).toBe("EXPIRADA");
  });
  it("cookie: httpOnly, SameSite, escopo de caminho do link; Secure só em HTTPS; logout apaga", () => {
    const token = gerarToken();
    const [pagina, api] = caminhosCookie(token);
    expect(pagina).toBe(`/compartilhado/${token}`);
    expect(api).toBe(`/api/v1/publico/compartilhado/${token}`);
    const cs = cookiesSessao(token, "valor", true);
    expect(cs).toHaveLength(2);
    for (const c of cs) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/SameSite=Lax/);
      expect(c).toMatch(/Secure/);
      expect(c).toMatch(/Max-Age=7200/);
    }
    expect(cs[0]).toContain(`Path=${pagina}`);
    expect(cs[1]).toContain(`Path=${api}`);
    expect(cookiesSessao(token, "valor", false).join(";")).not.toMatch(/Secure/);
    expect(cookiesSessao(token, null, true).join(";")).toMatch(/Max-Age=0/);
    expect(lerCookieSessao(new Headers({ cookie: "a=1; ged_comp=abc; b=2" }))).toBe("abc");
    expect(lerCookieSessao(new Headers({ cookie: "a=1" }))).toBeNull();
    expect(conexaoSegura({ url: "http://x/y", headers: new Headers({ "x-forwarded-proto": "https" }) })).toBe(true);
    expect(conexaoSegura({ url: "https://x/y", headers: new Headers() })).toBe(true);
    expect(conexaoSegura({ url: "http://localhost/y", headers: new Headers() })).toBe(false);
  });
});

describe("anti-abuso por IP", () => {
  beforeEach(() => _zerarLimites());
  const lanca = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return e as ErroApi;
    }
    return null;
  };
  it("10 pedidos de código por hora por IP; o 11º é 429 com retry_after", () => {
    for (let i = 0; i < 10; i++) expect(lanca(() => exigirEnvioOtpPermitido("1.1.1.1"))).toBeNull();
    const e = lanca(() => exigirEnvioOtpPermitido("1.1.1.1"));
    expect(e).toBeInstanceOf(ErroApi);
    expect(e!.status).toBe(429);
    expect((e!.details as { retry_after: number }).retry_after).toBeGreaterThan(0);
    expect(lanca(() => exigirEnvioOtpPermitido("2.2.2.2"))).toBeNull(); // outro IP não é afetado
  });
  it("códigos errados: 5 falhas bloqueiam o IP por 1 min (progressivo)", () => {
    for (let i = 0; i < 4; i++) registrarCodigoErradoIp("3.3.3.3");
    expect(lanca(() => exigirIpSemBloqueioOtp("3.3.3.3"))).toBeNull();
    registrarCodigoErradoIp("3.3.3.3");
    expect(lanca(() => exigirIpSemBloqueioOtp("3.3.3.3"))!.status).toBe(429);
    expect(lanca(() => exigirIpSemBloqueioOtp("4.4.4.4"))).toBeNull();
  });
  it("30 tokens inexistentes bloqueiam o IP (chute de links)", () => {
    for (let i = 0; i < 30; i++) registrarTokenRuim("5.5.5.5");
    expect(lanca(() => exigirVolumePermitido("5.5.5.5"))!.status).toBe(429);
    expect(lanca(() => exigirVolumePermitido("6.6.6.6"))).toBeNull();
  });
});

describe("escolha de itens da pasta", () => {
  const R = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const pastas = [
    { id: R, caminho_ids: [R] },
    { id: A, caminho_ids: [R, A] },
    { id: B, caminho_ids: [R, A, B] },
    { id: C, caminho_ids: [R, C] },
  ];
  it("pasta só aparece se ela ou uma descendente tem documento permitido; soma acumulada", () => {
    const { comConteudo, total } = calcularConteudoPastas(pastas, new Map([[B, 3]]));
    expect([...comConteudo].sort()).toEqual([A, B, R].sort());
    expect(comConteudo.has(C)).toBe(false); // subpasta só com sigilosos some (nem o nome aparece)
    expect(total.get(R)).toBe(3);
    expect(total.get(A)).toBe(3);
    expect(total.get(B)).toBe(3);
  });
  it("sem documentos permitidos nada tem conteúdo", () => {
    expect(calcularConteudoPastas(pastas, new Map()).comConteudo.size).toBe(0);
    expect(calcularConteudoPastas(pastas, new Map([[R, 0]])).comConteudo.size).toBe(0);
  });
  it("ZIP só da raiz ou de subpasta da subárvore visível; documento nunca tem ZIP", () => {
    const e = { tipo: "PASTA", raiz: { id: R, nome: "Raiz" }, pastas: pastas.map((p) => ({ ...p, parent_id: null, nome: "x" })) } as unknown as EscopoLink;
    expect(pastaDoZip(e)).toBe(R);
    expect(pastaDoZip(e, B)).toBe(B);
    expect(() => pastaDoZip(e, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).toThrow();
    expect(() => pastaDoZip({ tipo: "DOCUMENTO", raiz: null, pastas: [] } as unknown as EscopoLink)).toThrow();
  });
});
