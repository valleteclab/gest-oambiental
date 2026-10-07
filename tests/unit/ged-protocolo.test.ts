import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { _zerarLimites } from "@/lib/limite-login";
import { mascararCpfCnpj } from "@/lib/crypto";
import {
  ACOES_POR_SITUACAO, acoesPermitidas, anoBrasilia, erroSlug, estaEnvolvido, formatarNumeroProtocolo, gerarCodigosProtocolo, lerNumeroProtocolo, limitesAnexos, normalizarCodigoProtocolo,
  normalizarSlug, notificaInteressado, podeAgirNoProtocolo, podeAplicarAcao, podeRegistrarProtocolo, podeVerProtocolo, prazoPorDias, proximaSituacao, rotuloPublicoEvento, rotuloSituacao,
  SITUACAO_APOS, situacaoConclui, tipoSequenciaProtocolo, whereProtocoloVisivel, zAcaoProtocolo, zConsultaPublica, zEnvioPortal, zRegistroServidor, SITUACOES, ACOES_PROTOCOLO,
  type AtorProtocolo, type ParticipantesProtocolo,
} from "@/lib/ged/protocolo/regras";
import { cifrarInteressado, docMascarado, lerInteressado, mascararEmailInteressado } from "@/lib/ged/protocolo/pessoal";
import { htmlComprovante } from "@/lib/ged/protocolo/comprovante-html";
import { assuntoEmailProtocolo, renderEmailProtocolo } from "@/lib/ged/protocolo/templates";
import { janelaEnvioMs, limiteEnvioIp, permitirConsultaProtocolo, permitirEnvioPortal, registrarConsultaSemResultado } from "@/lib/ged/protocolo/limites";
import { linkConsulta } from "@/lib/ged/protocolo/aviso";
import { urlVerificacaoProtocolo } from "@/lib/ged/protocolo/servico";
import { CAPACIDADES_POR_PAPEL, isSomenteLeituraGed, podeProtocolar, veTodosProtocolos } from "@/lib/ged/papeis";

beforeAll(() => {
  process.env.DATA_KEY ??= "0".repeat(64);
});
beforeEach(() => {
  _zerarLimites();
  for (const k of ["PROTOCOLO_LIMITE_ENVIO_IP", "PROTOCOLO_LIMITE_ENVIO_PORTAL", "PROTOCOLO_LIMITE_ENVIO_JANELA_MIN"]) delete process.env[k];
});

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("numeração do protocolo", () => {
  it("formata PROT-ENT/SAI/INT-ano-sequência com 6 dígitos", () => {
    expect(formatarNumeroProtocolo("ENTRADA", 2026, 123)).toBe("PROT-ENT-2026-000123");
    expect(formatarNumeroProtocolo("SAIDA", 2026, 1)).toBe("PROT-SAI-2026-000001");
    expect(formatarNumeroProtocolo("INTERNO", 2027, 1234567)).toBe("PROT-INT-2027-1234567");
  });
  it("recusa ano e sequência inválidos", () => {
    expect(() => formatarNumeroProtocolo("ENTRADA", 1999, 1)).toThrow();
    expect(() => formatarNumeroProtocolo("ENTRADA", 2026, 0)).toThrow();
    expect(() => formatarNumeroProtocolo("ENTRADA", 2026, 1.5)).toThrow();
  });
  it("lê o número (maiúsculas/minúsculas e espaços) e devolve livro, ano e sequência", () => {
    expect(lerNumeroProtocolo(" prot-sai-2026-000045 ")).toEqual({ livro: "SAIDA", ano: 2026, sequencia: 45, numero: "PROT-SAI-2026-000045" });
    expect(lerNumeroProtocolo("PROT-ENT-2026-000123")?.livro).toBe("ENTRADA");
    for (const ruim of ["", "PROT-2026-000123", "PROT-XXX-2026-000001", "PROT-ENT-26-000001", "PROT-ENT-2026-1", "VAC-DOC-2026-000001", null, undefined]) expect(lerNumeroProtocolo(ruim as never)).toBeNull();
  });
  it("cada livro tem a sua sequência anual (contador separado por cliente/livro/ano)", () => {
    expect(tipoSequenciaProtocolo("ENTRADA")).toBe("PROT_ENT");
    expect(tipoSequenciaProtocolo("SAIDA")).toBe("PROT_SAI");
    expect(tipoSequenciaProtocolo("INTERNO")).toBe("PROT_INT");
  });
  it("o ano de numeração vira à meia-noite de Brasília", () => {
    expect(anoBrasilia(new Date("2026-12-31T23:30:00-03:00"))).toBe(2026);
    expect(anoBrasilia(new Date("2027-01-01T00:30:00-03:00"))).toBe(2027);
    expect(anoBrasilia(new Date("2027-01-01T02:30:00Z"))).toBe(2026); // 23:30 de 31/12 em Brasília
  });
});

describe("códigos de consulta e de verificação", () => {
  it("normaliza com ou sem hífens e em minúsculas; recusa formato inválido ou caracteres ambíguos", () => {
    expect(normalizarCodigoProtocolo("abcd-efgh-jkmn")).toBe("ABCD-EFGH-JKMN");
    expect(normalizarCodigoProtocolo("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    expect(normalizarCodigoProtocolo(" abcd efgh jkmn ")).toBe("ABCD-EFGH-JKMN");
    for (const ruim of ["", "ABCD-EFGH", "ABCD-EFGH-JKM0", "ABCD-EFGH-JKMO", "ABCD-EFGH-JKM1", "ABCD-EFGH-JKMI", "ABCD-EFGH-JKMNP"]) expect(normalizarCodigoProtocolo(ruim)).toBeNull();
  });
  it("gera dois códigos válidos, diferentes e não previsíveis", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigosProtocolo();
      expect(normalizarCodigoProtocolo(c.codigo_consulta)).toBe(c.codigo_consulta);
      expect(normalizarCodigoProtocolo(c.codigo_verificacao)).toBe(c.codigo_verificacao);
      expect(c.codigo_consulta).not.toBe(c.codigo_verificacao);
      vistos.add(c.codigo_consulta);
    }
    expect(vistos.size).toBe(200);
  });
  it("se o gerador repetir o valor, sorteia de novo até diferir", () => {
    const seq = ["AAAA-BBBB-CCCC", "AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"];
    const c = gerarCodigosProtocolo(() => seq.shift()!);
    expect(c).toEqual({ codigo_consulta: "AAAA-BBBB-CCCC", codigo_verificacao: "DDDD-EEEE-FFFF" });
  });
});

describe("máquina de situações", () => {
  it("recebido admite todas as ações; arquivado é terminal", () => {
    expect([...acoesPermitidas("RECEBIDO")].sort()).toEqual(["ANALISAR", "ARQUIVAR", "DEVOLVER", "ENCAMINHAR", "INDEFERIR", "RESPONDER"]);
    expect(acoesPermitidas("ARQUIVADO")).toEqual([]);
  });
  it("respondido, devolvido e indeferido só podem ser arquivados", () => {
    for (const s of ["RESPONDIDO", "DEVOLVIDO", "INDEFERIDO"] as const) expect(acoesPermitidas(s)).toEqual(["ARQUIVAR"]);
  });
  it("cada ação leva à situação esperada, e a ação proibida devolve null", () => {
    expect(proximaSituacao("RECEBIDO", "ANALISAR")).toBe("EM_ANALISE");
    expect(proximaSituacao("EM_ANALISE", "ENCAMINHAR")).toBe("ENCAMINHADO");
    expect(proximaSituacao("ENCAMINHADO", "ANALISAR")).toBe("EM_ANALISE");
    expect(proximaSituacao("EM_ANALISE", "RESPONDER")).toBe("RESPONDIDO");
    expect(proximaSituacao("RESPONDIDO", "ARQUIVAR")).toBe("ARQUIVADO");
    expect(proximaSituacao("EM_ANALISE", "DEVOLVER")).toBe("DEVOLVIDO");
    expect(proximaSituacao("EM_ANALISE", "INDEFERIR")).toBe("INDEFERIDO");
    expect(proximaSituacao("RESPONDIDO", "RESPONDER")).toBeNull();
    expect(proximaSituacao("EM_ANALISE", "ANALISAR")).toBeNull();
    expect(proximaSituacao("ARQUIVADO", "ENCAMINHAR")).toBeNull();
    expect(podeAplicarAcao("DEVOLVIDO", "INDEFERIR")).toBe(false);
  });
  it("toda ação aplicável leva a uma situação existente e nenhuma situação volta a RECEBIDO", () => {
    for (const s of SITUACOES) for (const a of ACOES_POR_SITUACAO[s]) {
      expect(SITUACOES).toContain(SITUACAO_APOS[a]);
      expect(SITUACAO_APOS[a]).not.toBe("RECEBIDO");
    }
    expect(ACOES_PROTOCOLO.length).toBe(6);
  });
  it("conclui o protocolo ao responder, arquivar, devolver ou indeferir", () => {
    expect(["RESPONDIDO", "ARQUIVADO", "DEVOLVIDO", "INDEFERIDO"].every((s) => situacaoConclui(s as never))).toBe(true);
    expect(["RECEBIDO", "EM_ANALISE", "ENCAMINHADO"].some((s) => situacaoConclui(s as never))).toBe(false);
  });
  it("saída e interno aparecem como 'Registrado' em vez de 'Recebido'", () => {
    expect(rotuloSituacao("RECEBIDO", "ENTRADA")).toBe("Recebido");
    expect(rotuloSituacao("RECEBIDO", "SAIDA")).toBe("Registrado");
    expect(rotuloSituacao("RECEBIDO", "INTERNO")).toBe("Registrado");
    expect(rotuloSituacao("EM_ANALISE", "INTERNO")).toBe("Em análise");
  });
  it("só 'iniciar análise' dispensa o aviso ao interessado", () => {
    expect(notificaInteressado("ANALISE")).toBe(false);
    for (const t of ["REGISTRO", "ENCAMINHAMENTO", "RESPOSTA", "ARQUIVAMENTO", "DEVOLUCAO", "INDEFERIMENTO"] as const) expect(notificaInteressado(t)).toBe(true);
  });
  it("devolver e indeferir exigem justificativa; responder exige texto; encaminhar exige um único destino", () => {
    expect(zAcaoProtocolo.safeParse({ acao: "DEVOLVER" }).success).toBe(false);
    expect(zAcaoProtocolo.safeParse({ acao: "DEVOLVER", texto: "curto" }).success).toBe(false);
    expect(zAcaoProtocolo.safeParse({ acao: "DEVOLVER", texto: "Falta o documento de identificação." }).success).toBe(true);
    expect(zAcaoProtocolo.safeParse({ acao: "INDEFERIR", texto: "          " }).success).toBe(false);
    expect(zAcaoProtocolo.safeParse({ acao: "RESPONDER", texto: "ok" }).success).toBe(false);
    expect(zAcaoProtocolo.safeParse({ acao: "RESPONDER", texto: "Certidão pronta para retirada." }).success).toBe(true);
    expect(zAcaoProtocolo.safeParse({ acao: "ARQUIVAR" }).success).toBe(true);
    expect(zAcaoProtocolo.safeParse({ acao: "ENCAMINHAR" }).success).toBe(false);
    expect(zAcaoProtocolo.safeParse({ acao: "ENCAMINHAR", destino_setor_id: UUID_A, destino_usuario_id: UUID_B }).success).toBe(false);
    expect(zAcaoProtocolo.safeParse({ acao: "ENCAMINHAR", destino_setor_id: UUID_A }).success).toBe(true);
    expect(zAcaoProtocolo.safeParse({ acao: "APAGAR" }).success).toBe(false);
  });
});

describe("validação do formulário público", () => {
  const ok = { nome: "Maria da Silva", cpf_cnpj: "529.982.247-25", email: "maria@exemplo.com", assunto_id: UUID_A, descricao: "Descrição suficiente do pedido.", aceite_lgpd: "true" };
  it("aceita um envio completo e normaliza o aceite", () => {
    const r = zEnvioPortal.safeParse(ok);
    expect(r.success).toBe(true);
    expect(zEnvioPortal.safeParse({ ...ok, aceite_lgpd: "on" }).success).toBe(true);
  });
  it("exige aceite de LGPD, CPF/CNPJ válido, e-mail válido, assunto e descrição mínima", () => {
    expect(zEnvioPortal.safeParse({ ...ok, aceite_lgpd: "false" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, aceite_lgpd: undefined }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, cpf_cnpj: "111.111.111-11" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, cpf_cnpj: "123" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, email: "não-é-email" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, assunto_id: "abc" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, descricao: "curta" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, nome: "Ma" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, telefone: "123" }).success).toBe(false);
    expect(zEnvioPortal.safeParse({ ...ok, telefone: "(74) 99999-0101" }).success).toBe(true);
  });
  it("aceita CNPJ válido e deixa o honeypot passar para o serviço decidir", () => {
    expect(zEnvioPortal.safeParse({ ...ok, cpf_cnpj: "11.222.333/0001-81" }).success).toBe(true);
    const r = zEnvioPortal.safeParse({ ...ok, website: "http://spam.example" });
    expect(r.success && r.data.website).toBe("http://spam.example");
    const vazio = zEnvioPortal.safeParse({ ...ok, website: "   " });
    expect(vazio.success && vazio.data.website).toBeUndefined();
  });
  it("a consulta pública normaliza número e código (inválidos viram null)", () => {
    expect(zConsultaPublica.parse({ numero: " prot-ent-2026-000007", codigo: "abcdefghjkmn" })).toEqual({ numero: "PROT-ENT-2026-000007", codigo: "ABCD-EFGH-JKMN" });
    expect(zConsultaPublica.parse({ numero: "x", codigo: "y" })).toEqual({ numero: null, codigo: null });
  });
});

describe("registro por servidor", () => {
  const base = { assunto: "Assunto do protocolo", interessado: { nome: "Fulano de Tal" } };
  it("entrada exige remetente e um destino (setor OU pessoa)", () => {
    expect(zRegistroServidor.safeParse({ livro: "ENTRADA", ...base }).success).toBe(false);
    expect(zRegistroServidor.safeParse({ livro: "ENTRADA", ...base, destino_setor_id: UUID_A }).success).toBe(true);
    expect(zRegistroServidor.safeParse({ livro: "ENTRADA", ...base, destino_setor_id: UUID_A, destino_usuario_id: UUID_B }).success).toBe(false);
    expect(zRegistroServidor.safeParse({ livro: "ENTRADA", assunto: "Assunto ok", destino_setor_id: UUID_A }).success).toBe(false);
  });
  it("saída exige setor de origem e destinatário externo, sem destino interno", () => {
    expect(zRegistroServidor.safeParse({ livro: "SAIDA", ...base }).success).toBe(false);
    expect(zRegistroServidor.safeParse({ livro: "SAIDA", ...base, origem_setor_id: UUID_A }).success).toBe(true);
  });
  it("interno exige origem e destino, sem interessado externo", () => {
    expect(zRegistroServidor.safeParse({ livro: "INTERNO", assunto: "Memorando", origem_setor_id: UUID_A }).success).toBe(false);
    expect(zRegistroServidor.safeParse({ livro: "INTERNO", assunto: "Memorando", origem_setor_id: UUID_A, destino_usuario_id: UUID_B }).success).toBe(true);
  });
  it("valida CPF/CNPJ informado, mas deixa em branco passar no balcão; prioridade padrão NORMAL", () => {
    const r = zRegistroServidor.safeParse({ livro: "ENTRADA", assunto: "Assunto", interessado: { nome: "Fulano de Tal", cpf_cnpj: "" }, destino_setor_id: UUID_A });
    expect(r.success && r.data.prioridade).toBe("NORMAL");
    expect(zRegistroServidor.safeParse({ livro: "ENTRADA", assunto: "Assunto", interessado: { nome: "Fulano de Tal", cpf_cnpj: "123.456.789-00" }, destino_setor_id: UUID_A }).success).toBe(false);
  });
  it("livro desconhecido é recusado", () => {
    expect(zRegistroServidor.safeParse({ livro: "OUTRO", ...base }).success).toBe(false);
  });
});

describe("dados pessoais do interessado", () => {
  it("CPF/CNPJ mascarado nunca mostra o número completo", () => {
    expect(mascararCpfCnpj("529.982.247-25")).toBe("***.982.247-**");
    expect(mascararCpfCnpj("11222333000181")).toBe("11.222.333/****-**");
    expect(docMascarado("52998224725")).toBe("***.982.247-**");
    expect(docMascarado(null)).toBeNull();
  });
  it("nome, documento, e-mail e telefone saem cifrados; o hash do documento ignora a formatação", () => {
    const c = cifrarInteressado({ nome: "Maria da Silva", cpf_cnpj: "529.982.247-25", email: " Maria@Exemplo.COM ", telefone: "(74) 99999-0101" });
    for (const v of [c.interessado_nome_cifrado, c.interessado_doc_cifrado, c.interessado_email_cifrado, c.interessado_telefone_cifrado]) {
      expect(v).toMatch(/^v1:/);
      expect(v).not.toContain("Maria");
      expect(v).not.toContain("52998224725");
    }
    expect(c.interessado_doc_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.interessado_doc_hash).toBe(cifrarInteressado({ nome: "x", cpf_cnpj: "52998224725" }).interessado_doc_hash);
    expect(lerInteressado(c)).toEqual({ nome: "Maria da Silva", cpf_cnpj: "52998224725", email: "maria@exemplo.com", telefone: "74999990101" });
  });
  it("sem dados, nada é gravado; valor corrompido não derruba a leitura", () => {
    expect(cifrarInteressado(null)).toEqual({ interessado_nome_cifrado: null, interessado_doc_cifrado: null, interessado_doc_hash: null, interessado_email_cifrado: null, interessado_telefone_cifrado: null });
    expect(lerInteressado({ interessado_nome_cifrado: "v1:aaaa:bbbb:cccc" }).nome).toBeNull();
  });
  it("máscara de e-mail para a caixa de saída", () => {
    expect(mascararEmailInteressado("maria.silva@exemplo.com")).toBe("ma***@exemplo.com");
  });
});

describe("limites de anexos e endereço público", () => {
  it("usa a configuração, com piso e teto do sistema", () => {
    expect(limitesAnexos({})).toMatchObject({ max_anexos: 5, max_mb: 10 });
    expect(limitesAnexos({ protocolo_max_anexos: 99, protocolo_max_mb: 99 })).toMatchObject({ max_anexos: 10, max_mb: 25, max_bytes: 25 * 1024 * 1024 });
    expect(limitesAnexos({ protocolo_max_anexos: 0, protocolo_max_mb: 0 })).toMatchObject({ max_anexos: 0, max_mb: 1 });
  });
  it("normaliza e valida o slug; palavras reservadas e formatos ruins são recusados", () => {
    expect(normalizarSlug("  Câmara Municipal de Vale das Acácias! ")).toBe("camara-municipal-de-vale-das-acacias");
    expect(erroSlug("camara-municipal")).toBeNull();
    expect(erroSlug("ab")).toBeTruthy();
    expect(erroSlug("-camara")).toBeTruthy();
    expect(erroSlug("Camara")).toBeTruthy();
    expect(erroSlug("api")).toBeTruthy();
    expect(erroSlug("ged")).toBeTruthy();
  });
  it("prazo por dias vai até o fim do dia e ignora vazio", () => {
    expect(prazoPorDias(new Date("2026-10-01T12:00:00Z"), null)).toBeNull();
    expect(prazoPorDias(new Date("2026-10-01T12:00:00Z"), 0)).toBeNull();
    expect(prazoPorDias(new Date("2026-10-01T12:00:00Z"), 10)?.toISOString()).toBe("2026-10-11T23:59:00.000Z");
  });
});

describe("consulta pública não vaza nada interno", () => {
  it("o andamento público traz só o rótulo do evento", () => {
    expect(rotuloPublicoEvento("REGISTRO", "ENTRADA")).toBe("Protocolo recebido pelo órgão");
    expect(rotuloPublicoEvento("ENCAMINHAMENTO")).toBe("Encaminhado para análise");
    expect(rotuloPublicoEvento("INDEFERIMENTO")).toBe("Indeferido");
  });
  it("links: verificação no QR e consulta (só com slug)", () => {
    expect(urlVerificacaoProtocolo("ABCD-EFGH-JKMN", "https://app.exemplo.demo/")).toBe("https://app.exemplo.demo/verificar/protocolo/ABCD-EFGH-JKMN");
    expect(linkConsulta(null, "PROT-ENT-2026-000001", "ABCD-EFGH-JKMN")).toBeNull();
    expect(linkConsulta("vale-demo", "PROT-ENT-2026-000001", "ABCD-EFGH-JKMN", "https://app.exemplo.demo")).toBe("https://app.exemplo.demo/protocolo/vale-demo/consulta?numero=PROT-ENT-2026-000001&codigo=ABCD-EFGH-JKMN");
  });
});

describe("e-mail ao interessado", () => {
  const ctx = { evento: "PROTOCOLO_RECEBIDO" as const, organizacao_nome: "Câmara <Fictícia>", destinatario_nome: "Maria da Silva", numero: "PROT-ENT-2026-000007", assunto: "Certidão <script>x</script>", situacao_rotulo: "Recebido", codigo_consulta: "ABCD-EFGH-JKMN", link_consulta: "https://app.exemplo.demo/protocolo/v/consulta?numero=A&codigo=B", agora: new Date("2026-10-07T17:05:00Z") };
  it("traz 'Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)', número, código e link, sem anexos", () => {
    const r = renderEmailProtocolo(ctx);
    expect(r.assunto).toBe("Protocolo PROT-ENT-2026-000007 recebido");
    for (const c of [r.texto, r.html]) {
      expect(c).toContain("Enviado em 07/10/2026 às 14:05 (horário de Brasília)");
      expect(c).toContain("PROT-ENT-2026-000007");
      expect(c).toContain("ABCD-EFGH-JKMN");
    }
    expect(r.html).toContain('href="https://app.exemplo.demo/protocolo/v/consulta?numero=A&amp;codigo=B"');
    expect(r.texto).toContain("Sem anexos");
    expect(r.texto).toContain("Olá, Maria.");
  });
  it("escapa HTML e não vaza CPF", () => {
    const r = renderEmailProtocolo(ctx);
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });
  it("mudança de situação usa a situação no assunto; sem link quando o portal está desligado", () => {
    expect(assuntoEmailProtocolo("PROTOCOLO_SITUACAO", "PROT-ENT-2026-000007", "Respondido")).toBe("Protocolo PROT-ENT-2026-000007: Respondido");
    const r = renderEmailProtocolo({ ...ctx, evento: "PROTOCOLO_SITUACAO", situacao_rotulo: "Respondido", link_consulta: null });
    expect(r.texto).toContain("mudou de situação: Respondido");
    expect(r.html).not.toContain("<a href");
  });
});

describe("comprovante em HTML", () => {
  const d = {
    organizacao: { nome: "Câmara <b>Fictícia</b>", logo_data_uri: null }, numero: "PROT-ENT-2026-000007", livro: "ENTRADA" as const, registrado_em: new Date("2026-10-07T17:05:00Z"),
    assunto: "Certidão", interessado: { nome: "Maria da Silva", doc_mascarado: mascararCpfCnpj("529.982.247-25") }, origem_rotulo: null, destino_rotulo: "Protocolo",
    anexos: [{ nome: "doc <1>.pdf", sha256: "a".repeat(64), tamanho: 2048 }], codigo_consulta: "ABCD-EFGH-JKMN", url_consulta: "https://app.exemplo.demo/protocolo/v/consulta",
    codigo_verificacao: "WXYZ-2345-6789", url_verificacao: "https://app.exemplo.demo/verificar/protocolo/WXYZ-2345-6789", qr_data_uri: "data:image/png;base64,AAAA", com_certificado: false, emitido_em: new Date("2026-10-07T17:05:30Z"),
  };
  it("mostra número, data/hora de Brasília, CPF mascarado, anexos com sha256, código e QR", () => {
    const h = htmlComprovante(d);
    expect(h).toContain("PROT-ENT-2026-000007");
    expect(h).toContain("07/10/2026 às 14:05 (horário de Brasília)");
    expect(h).toContain("***.982.247-**");
    expect(h).not.toContain("529.982.247-25");
    expect(h).toContain("a".repeat(64));
    expect(h).toContain("ABCD-EFGH-JKMN");
    expect(h).toContain("WXYZ-2345-6789");
    expect(h).toContain('src="data:image/png;base64,AAAA"');
    expect(h).toContain("assinatura eletrônica simples");
  });
  it("escapa HTML dos textos e muda a nota quando há certificado", () => {
    const h = htmlComprovante({ ...d, com_certificado: true });
    expect(h).not.toContain("<b>Fictícia</b>");
    expect(h).toContain("Câmara &lt;b&gt;Fictícia&lt;/b&gt;");
    expect(h).toContain("doc &lt;1&gt;.pdf");
    expect(h).toContain("certificado A1 do órgão");
  });
  it("sem código de consulta (saída/interno ou portal desligado) o bloco 'Acompanhe' some", () => {
    expect(htmlComprovante({ ...d, codigo_consulta: null, url_consulta: null })).not.toContain("Acompanhe o andamento");
  });
});

describe("limites contra abuso (mesmo mecanismo do login)", () => {
  it("por IP: o 9º envio na hora é barrado e outro IP não é afetado", () => {
    expect(limiteEnvioIp()).toBe(8);
    const t0 = 5_000_000;
    for (let i = 0; i < 8; i++) expect(permitirEnvioPortal("203.0.113.9", UUID_A, t0 + i)).toBe(true);
    expect(permitirEnvioPortal("203.0.113.9", UUID_A, t0 + 100)).toBe(false);
    expect(permitirEnvioPortal("203.0.113.10", UUID_A, t0 + 100)).toBe(true);
  });
  it("libera depois da janela de uma hora", () => {
    const t0 = 7_000_000;
    for (let i = 0; i < 8; i++) permitirEnvioPortal("198.51.100.1", UUID_A, t0 + i);
    expect(permitirEnvioPortal("198.51.100.1", UUID_A, t0 + 1000)).toBe(false);
    expect(permitirEnvioPortal("198.51.100.1", UUID_A, t0 + janelaEnvioMs() + 10)).toBe(true);
  });
  it("respeita a variável de ambiente do limite por IP", () => {
    process.env.PROTOCOLO_LIMITE_ENVIO_IP = "2";
    const t0 = 9_000_000;
    expect(permitirEnvioPortal("192.0.2.1", UUID_B, t0)).toBe(true);
    expect(permitirEnvioPortal("192.0.2.1", UUID_B, t0 + 1)).toBe(true);
    expect(permitirEnvioPortal("192.0.2.1", UUID_B, t0 + 2)).toBe(false);
  });
  it("teto por portal impede enxame de IPs", () => {
    process.env.PROTOCOLO_LIMITE_ENVIO_PORTAL = "3";
    const t0 = 11_000_000;
    expect(permitirEnvioPortal("10.0.0.1", UUID_A, t0)).toBe(true);
    expect(permitirEnvioPortal("10.0.0.2", UUID_A, t0)).toBe(true);
    expect(permitirEnvioPortal("10.0.0.3", UUID_A, t0)).toBe(true);
    expect(permitirEnvioPortal("10.0.0.4", UUID_A, t0)).toBe(false);
    expect(permitirEnvioPortal("10.0.0.4", UUID_B, t0)).toBe(true); // outro portal
  });
  it("consulta: 10 falhas bloqueiam o IP; 8 falhas bloqueiam o protocolo-alvo para qualquer IP", () => {
    const t0 = 13_000_000;
    for (let i = 0; i < 10; i++) registrarConsultaSemResultado("203.0.113.50", UUID_A, null, t0 + i);
    expect(permitirConsultaProtocolo("203.0.113.50", UUID_A, null, t0 + 100)).toBe(false);
    expect(permitirConsultaProtocolo("203.0.113.51", UUID_A, null, t0 + 100)).toBe(true);
    for (let i = 0; i < 8; i++) registrarConsultaSemResultado(`198.51.100.${i}`, UUID_A, "PROT-ENT-2026-000001", t0 + i);
    expect(permitirConsultaProtocolo("198.51.100.99", UUID_A, "PROT-ENT-2026-000001", t0 + 100)).toBe(false);
    expect(permitirConsultaProtocolo("198.51.100.99", UUID_A, "PROT-ENT-2026-000002", t0 + 100)).toBe(true);
    expect(permitirConsultaProtocolo("198.51.100.99", UUID_B, "PROT-ENT-2026-000001", t0 + 100)).toBe(true); // outro cliente
  });
});

describe("permissões do protocolo", () => {
  const ator = (papel: AtorProtocolo["papel"], setor_ids: string[] = [], usuario_id = UUID_A): AtorProtocolo => ({ papel, usuario_id, setor_ids });
  const nada: ParticipantesProtocolo = { criado_por_id: null, responsavel_id: null, destino_usuario_id: null, destino_setor_id: null, setor_atual_id: null, origem_setor_id: null };
  const SETOR = "33333333-3333-4333-8333-333333333333";
  const OUTRO_SETOR = "44444444-4444-4444-8444-444444444444";

  it("registrar: Admin, Gestor e Usuário; Leitor e Auditor nunca", () => {
    expect(["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"].every((p) => podeRegistrarProtocolo(p as never))).toBe(true);
    expect(podeRegistrarProtocolo("GED_LEITOR")).toBe(false);
    expect(podeRegistrarProtocolo("GED_AUDITOR")).toBe(false);
    expect(CAPACIDADES_POR_PAPEL.protocolar).toEqual(["GED_ADMIN", "GED_GESTOR", "GED_USUARIO"]);
    expect(podeProtocolar({ membro: { papel: "GED_USUARIO" } })).toBe(true);
    expect(veTodosProtocolos({ membro: { papel: "GED_AUDITOR" } })).toBe(true);
    expect(veTodosProtocolos({ membro: { papel: "GED_USUARIO" } })).toBe(false);
    expect(isSomenteLeituraGed({ membro: { papel: "GED_AUDITOR" } })).toBe(true);
  });
  it("Admin e Gestor veem e movimentam todos; Auditor vê todos mas nunca movimenta", () => {
    for (const p of ["GED_ADMIN", "GED_GESTOR"] as const) {
      expect(podeVerProtocolo(ator(p), nada)).toBe(true);
      expect(podeAgirNoProtocolo(ator(p), nada)).toBe(true);
    }
    expect(podeVerProtocolo(ator("GED_AUDITOR"), nada)).toBe(true);
    expect(podeAgirNoProtocolo(ator("GED_AUDITOR"), nada)).toBe(false);
  });
  it("Usuário e Leitor só veem o que os envolve; só o Usuário movimenta", () => {
    expect(podeVerProtocolo(ator("GED_USUARIO"), nada)).toBe(false);
    expect(podeAgirNoProtocolo(ator("GED_USUARIO"), nada)).toBe(false);
    expect(podeVerProtocolo(ator("GED_USUARIO"), { ...nada, criado_por_id: UUID_A })).toBe(true);
    expect(podeVerProtocolo(ator("GED_USUARIO"), { ...nada, responsavel_id: UUID_A })).toBe(true);
    expect(podeVerProtocolo(ator("GED_USUARIO"), { ...nada, destino_usuario_id: UUID_A })).toBe(true);
    expect(podeVerProtocolo(ator("GED_USUARIO", [SETOR]), { ...nada, setor_atual_id: SETOR })).toBe(true);
    expect(podeVerProtocolo(ator("GED_USUARIO", [SETOR]), { ...nada, destino_setor_id: SETOR })).toBe(true);
    expect(podeVerProtocolo(ator("GED_USUARIO", [SETOR]), { ...nada, origem_setor_id: SETOR })).toBe(true);
    expect(podeVerProtocolo(ator("GED_USUARIO", [SETOR]), { ...nada, setor_atual_id: OUTRO_SETOR })).toBe(false);
    expect(podeAgirNoProtocolo(ator("GED_USUARIO", [SETOR]), { ...nada, setor_atual_id: SETOR })).toBe(true);
    expect(podeVerProtocolo(ator("GED_LEITOR", [SETOR]), { ...nada, setor_atual_id: SETOR })).toBe(true);
    expect(podeAgirNoProtocolo(ator("GED_LEITOR", [SETOR]), { ...nada, setor_atual_id: SETOR })).toBe(false);
    expect(estaEnvolvido(ator("GED_USUARIO"), { ...nada, criado_por_id: UUID_B })).toBe(false);
  });
  it("o filtro de listas é vazio para quem vê tudo e restringe os demais por usuário e setores", () => {
    expect(whereProtocoloVisivel(ator("GED_ADMIN"))).toEqual({});
    expect(whereProtocoloVisivel(ator("GED_AUDITOR"))).toEqual({});
    const w = whereProtocoloVisivel(ator("GED_USUARIO", [SETOR])) as { OR: unknown[] };
    expect(w.OR).toHaveLength(6);
    expect(JSON.stringify(w)).toContain(SETOR);
    expect((whereProtocoloVisivel(ator("GED_USUARIO")) as { OR: unknown[] }).OR).toHaveLength(3);
  });
  it("conjunto de ações por situação é coerente com acoesPermitidas", () => {
    expect(acoesPermitidas("EM_ANALISE")).toEqual(ACOES_POR_SITUACAO.EM_ANALISE);
  });
});
