import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  PDF_EXEMPLO_GED, USUARIOS_GED, aceitarDialogos, aguardarHidratacao, auth, bancoCmd, carregarIdsGed, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, semVazamento, marcasDe, submeter, sufixoUnico,
  temBanco, tokenCache,
} from "./ged-helpers";

// T23 – GED: PROTOCOLO (livro de entrada/saída/interno, comprovante, portal público do cidadão, consulta, verificação pública,
// isolamento entre clientes e anti-abuso). Seed: `E2E_GED_IDS=1 npm run seed:ged-demo` (portal de VAC LIGADO em
// /protocolo/vale-das-acacias-demo; AAC tem o endereço /protocolo/aguas-do-cerrado-demo com o portal DESLIGADO). Desktop apenas (grava dados).
// O envio dos e-mails ao interessado é do worker `ged-notificar`; no E2E t20-banco.ts executa o mesmo processamento direto no banco.

test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const ids = IDS!;
const A = USUARIOS_GED.A;
const B = USUARIOS_GED.B;
test.describe.configure({ timeout: 240_000 });

const SLUG_A = ids.A.portal?.slug ?? "vale-das-acacias-demo";
const SLUG_B = ids.B.portal?.slug ?? "aguas-do-cerrado-demo";
const CPF_VALIDO = "529.982.247-25";
const NOME_CIDADAO = "Joana Prado Mendonça (E2E)";
/** IP exclusivo por execução: o limite de envios é por IP e não deve afetar outras execuções no mesmo servidor. */
const ipFalso = () => `198.51.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const pdfBuf = () => readFileSync(PDF_EXEMPLO_GED);

type Ficha = { id: string; numero: string; situacao: string; codigo_consulta: string | null; codigo_verificacao: string; comprovante: { emitido: boolean; sha256: string | null }; eventos: { rotulo: string; texto_publico: string | null }[]; anexos: unknown[] };
const ficha = async (request: APIRequestContext, email: string, id: string): Promise<Ficha> => {
  const r = await request.get(`/api/v1/ged/protocolos/${id}`, { headers: auth(await tokenCache(request, email)) });
  expect(r.status(), `GET ficha ${id}`).toBe(200);
  return r.json();
};
const texto = (pdf: Buffer): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "t23-"));
  try {
    const f = path.join(dir, "c.pdf");
    writeFileSync(f, pdf);
    return execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const temPdftotext = () => { try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } };

// Estado compartilhado entre os testes (executam em ordem, 1 worker)
const e: { balcao?: Ficha; saida?: Ficha; portal?: { numero: string; codigo: string; id?: string; comprovante: Buffer }; suf: string; ip: string } = { suf: sufixoUnico(), ip: ipFalso() };

test.describe.serial("T23 – protocolo", () => {
  test("T23a – servidor registra ENTRADA no balcão (comprovante) e SAÍDA pela interface", async ({ page, request }) => {
    aceitarDialogos(page);
    await loginGed(page, A.servidor1);
    await irPara(page, "/ged/protocolo/novo");
    await expect(page.getByRole("heading", { name: "Novo protocolo" })).toBeVisible();

    // ENTRADA no balcão
    await page.locator("#i_nome").fill(`Fornecedor de Balcão ${e.suf}`);
    await page.locator("#i_cpf_cnpj").fill("11.222.333/0001-81");
    await page.locator("#i_email").fill(`balcao.${e.suf}@exemplo.demo`);
    await page.locator("#assunto").fill(`Entrega de proposta ${e.suf}`);
    await page.locator("#descricao").fill("Proposta comercial entregue no balcão (E2E).");
    await page.locator("#destino").selectOption({ label: "Licitações (LIC)" });
    await page.locator("#arquivos").setInputFiles(PDF_EXEMPLO_GED);
    await aguardarHidratacao(page);
    await page.getByRole("button", { name: "Registrar protocolo" }).click();
    await page.waitForURL(/\/ged\/protocolo\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: /^PROT-ENT-\d{4}-\d{6}$/ })).toBeVisible();
    await expect(page.getByTestId("situacao-protocolo")).toContainText("Recebido");
    await expect(page.getByTestId("anexos-protocolo").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("andamento-protocolo").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("comprovante-info")).toContainText("Emitido em");
    const id = page.url().split("/").pop()!;
    e.balcao = await ficha(request, A.servidor1, id);
    expect(e.balcao.numero).toMatch(/^PROT-ENT-\d{4}-\d{6}$/);
    expect(e.balcao.comprovante.emitido).toBe(true);

    // comprovante em PDF (mesmo arquivo registrado)
    const c = await page.request.get(`/api/v1/ged/protocolos/${id}/comprovante`);
    expect(c.status()).toBe(200);
    expect(c.headers()["content-type"]).toContain("application/pdf");
    expect(c.headers()["cache-control"]).toContain("no-store");
    const corpo = Buffer.from(await c.body());
    expect(corpo.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(c.headers()["x-content-sha256"]).toBe(e.balcao.comprovante.sha256);
    if (temPdftotext()) {
      const t = texto(corpo);
      expect(t).toContain(e.balcao.numero);
      expect(t).toContain("11.222.333/****-**"); // CNPJ mascarado
      expect(t).not.toContain("11.222.333/0001-81");
      expect(t).toContain("horário de Brasília");
      expect(t.replace(/\s+/g, "")).toContain(createHash("sha256").update(pdfBuf()).digest("hex")); // sha256 do anexo (quebrado em linhas no PDF)
    }

    // SAÍDA
    await irPara(page, "/ged/protocolo/novo?livro=SAIDA");
    await page.getByLabel("Saída").check();
    await page.locator("#origem_setor_id").selectOption({ label: "Licitações (LIC)" });
    await page.locator("#i_nome").fill(`Órgão Destinatário ${e.suf}`);
    await page.locator("#assunto").fill(`Ofício de saída ${e.suf}`);
    await page.locator("#arquivos").setInputFiles(PDF_EXEMPLO_GED);
    await aguardarHidratacao(page);
    await page.getByRole("button", { name: "Registrar protocolo" }).click();
    await page.waitForURL(/\/ged\/protocolo\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: /^PROT-SAI-\d{4}-\d{6}$/ })).toBeVisible();
    e.saida = await ficha(request, A.servidor1, page.url().split("/").pop()!);
    expect(e.saida.codigo_consulta).toBeNull(); // só a entrada tem código de consulta

    // livro: filtros por tipo, situação e busca
    await irPara(page, `/ged/protocolo?livro=SAIDA&q=${encodeURIComponent(`saída ${e.suf}`)}`);
    await expect(page.getByTestId("protocolo-item")).toHaveCount(1);
    await irPara(page, `/ged/protocolo?livro=ENTRADA&situacao=RECEBIDO&q=${encodeURIComponent(e.suf)}`);
    await expect(page.getByTestId("protocolo-item").filter({ hasText: e.balcao.numero })).toHaveCount(1);
    await irPara(page, `/ged/protocolo?livro=INTERNO&q=${encodeURIComponent(e.suf)}`);
    await expect(page.getByTestId("total-protocolos")).toContainText("0 protocolo(s)");
    // busca por CPF/CNPJ (hash, sem expor o número)
    await irPara(page, "/ged/protocolo?q=11.222.333/0001-81");
    await expect(page.getByTestId("protocolo-item").filter({ hasText: e.balcao.numero })).toHaveCount(1);
  });

  test("T23b – andamento: analisar, encaminhar, regras da máquina de situações e justificativas", async ({ page, request }) => {
    test.skip(!e.balcao, "depende de T23a");
    aceitarDialogos(page);
    await loginGed(page, A.servidor1);
    await irPara(page, `/ged/protocolo/${e.balcao!.id}`);
    // iniciar análise
    // (o formulário some depois de salvar: confere-se o resultado – situação e andamento –, não a mensagem)
    const analisar = page.getByRole("form", { name: "Iniciar análise" });
    await page.getByText("Iniciar análise", { exact: true }).click();
    await aguardarHidratacao(page);
    await analisar.getByRole("button", { name: "Assumir e iniciar análise" }).click();
    await expect(page.getByTestId("situacao-protocolo")).toContainText("Em análise", { timeout: 30_000 });
    await expect(page.getByTestId("andamento-protocolo").locator("li")).toHaveCount(2);

    const tk = await tokenCache(request, A.servidor1);
    // devolver sem justificativa = 422; transição proibida (analisar de novo) = 409
    let r = await request.post(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tk), data: { acao: "DEVOLVER" } });
    expect(r.status()).toBe(422);
    r = await request.post(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tk), data: { acao: "ANALISAR" } });
    expect(r.status()).toBe(409);
    // encaminhar ao Financeiro: o documento anexado segue pelo trâmite
    r = await request.post(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tk), data: { acao: "ENCAMINHAR", destino_setor_id: ids.A.setores["FIN"], texto: "Para parecer financeiro." } });
    expect(r.status(), await r.text()).toBe(201);
    const enc = await r.json();
    expect(enc.situacao).toBe("ENCAMINHADO");
    expect(enc.documentos_movidos).toBe(1);
    const f = await ficha(request, A.servidor1, e.balcao!.id);
    expect(f.eventos.map((x) => x.rotulo)).toEqual(["Protocolo recebido pelo órgão", "Em análise", "Encaminhado para análise"]);

    // servidor2 (Financeiro) passou a ver o protocolo e o documento; devolve com justificativa
    const tk2 = await tokenCache(request, A.servidor2);
    r = await request.get(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tk2) });
    expect(r.status()).toBe(200);
    r = await request.post(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tk2), data: { acao: "DEVOLVER", texto: "Falta a certidão negativa de débitos. Protocole novamente." } });
    expect(r.status(), await r.text()).toBe(201);
    expect((await r.json()).situacao).toBe("DEVOLVIDO");
    // devolvido só admite arquivar; resposta depois de devolvido = 409
    r = await request.post(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tk2), data: { acao: "RESPONDER", texto: "Tentativa depois de devolvido" } });
    expect(r.status()).toBe(409);
    const f2 = await ficha(request, A.servidor2, e.balcao!.id);
    expect(f2.situacao).toBe("DEVOLVIDO");
    expect(f2.eventos.at(-1)?.texto_publico).toContain("certidão negativa");
  });

  test("T23c – cidadão protocola pelo portal público, baixa o comprovante e consulta o andamento (sem login)", async ({ page, request }) => {
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": e.ip });
    const resp = await page.goto(`/protocolo/${SLUG_A}`);
    expect(resp?.status()).toBe(200);
    expect(resp?.headers()["x-robots-tag"]).toContain("noindex");
    expect(resp?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByTestId("portal-orgao")).toContainText("Vale das Acácias");
    await expect(page.getByTestId("portal-orientacao")).toContainText("Atendimento de segunda a sexta");
    await aguardarHidratacao(page);

    await page.locator("#pp-nome").fill(NOME_CIDADAO);
    await page.locator("#pp-doc").fill(CPF_VALIDO);
    await page.locator("#pp-email").fill(`cidadao.${e.suf}@exemplo.demo`);
    await page.locator("#pp-tel").fill("(74) 99999-0000");
    await page.locator("#pp-assunto").selectOption({ label: "Documentos de licitação (fornecedores)" });
    await page.locator("#pp-desc").fill(`Envio de documentos de habilitação ${e.suf} para o pregão em andamento.`);
    await page.locator("#pp-arq").setInputFiles(PDF_EXEMPLO_GED);
    // sem aceite de LGPD o formulário não envia
    await page.getByTestId("enviar-protocolo").click();
    await expect(page.getByTestId("protocolo-enviado")).toHaveCount(0);
    await page.getByTestId("aceite-lgpd").check();
    await page.getByTestId("enviar-protocolo").click();
    await expect(page.getByTestId("protocolo-enviado")).toBeVisible({ timeout: 90_000 });
    const numero = (await page.getByTestId("numero-protocolo").innerText()).trim();
    const codigo = (await page.getByTestId("codigo-consulta").innerText()).trim();
    expect(numero).toMatch(/^PROT-ENT-\d{4}-\d{6}$/);
    expect(codigo).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

    // comprovante em PDF para baixar
    const href = await page.getByTestId("baixar-comprovante").getAttribute("href");
    expect(href).toBeTruthy();
    const dl = await page.request.get(href!);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-type"]).toContain("application/pdf");
    const comprovante = Buffer.from(await dl.body());
    expect(comprovante.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    if (temPdftotext()) {
      const t = texto(comprovante);
      expect(t).toContain(numero);
      expect(t).toContain(codigo);
      expect(t).toContain("***.982.247-**"); // CPF mascarado
      expect(t).not.toContain(CPF_VALIDO);
      expect(t).not.toContain("52998224725");
    }
    // sem o código (ou com código de outro) não baixa
    const sem = await request.get(`/api/v1/publico/protocolo/${SLUG_A}/comprovante?numero=${numero}&codigo=AAAA-BBBB-CCCC`, { headers: { "x-forwarded-for": e.ip } });
    expect(sem.status()).toBe(404);

    // consulta pública: número + código
    await page.goto(`/protocolo/${SLUG_A}/consulta`);
    await page.locator("#c-numero").fill(numero);
    await page.locator("#c-codigo").fill(codigo.toLowerCase().replace(/-/g, " "));
    await page.getByTestId("consultar").click();
    await expect(page.getByTestId("consulta-resultado")).toContainText(numero);
    await expect(page.getByTestId("consulta-situacao")).toContainText("Recebido");
    const html = await page.locator("main").innerText();
    for (const proibido of [NOME_CIDADAO, "Joana", CPF_VALIDO, "52998224725", `cidadao.${e.suf}@exemplo.demo`, "99999-0000"]) expect(html).not.toContain(proibido);
    await expect(page.getByTestId("consulta-andamento").locator("li")).toHaveCount(1);
    // código errado: mensagem genérica
    await page.goto(`/protocolo/${SLUG_A}/consulta?numero=${numero}&codigo=ZZZZ-ZZZZ-ZZZZ`);
    await expect(page.getByTestId("consulta-nao-encontrado")).toBeVisible();

    e.portal = { numero, codigo, comprovante };

    // o servidor enxerga o protocolo como vindo do portal, com o aceite de LGPD, e o documento é restrito
    const lista = await request.get(`/api/v1/ged/protocolos?q=${numero}`, { headers: auth(await tokenCache(request, A.admin)) });
    const item = itensDe(await lista.json()).find((p) => p.numero === numero);
    expect(item, "protocolo do portal no livro").toBeTruthy();
    expect(item!.origem).toBe("PORTAL");
    e.portal.id = item!.id as string;
    const fp = await ficha(request, A.admin, e.portal.id);
    expect(fp.anexos).toHaveLength(1);
    expect(fp.codigo_consulta).toBe(codigo);

    const pagina = await page.context().newPage();
    await pagina.close();
  });

  test("T23d – e-mails ao interessado: confirmação e mudança de situação, com a consulta pública mostrando a resposta", async ({ request, page }) => {
    test.skip(!temBanco(), "Sem DATABASE_URL: o processamento da caixa de saída roda direto no banco (substitui o worker).");
    test.skip(!e.portal?.id, "depende de T23c");
    const suf = e.suf;
    bancoCmd("processar");
    let com = bancoCmd<{ evento: string; status: string; enviado_em: string | null; destinatario_mascarado: string; assunto: string; email: { para: string; assunto: string; corpo: string } | null }[]>("protocolo-comunicacoes", e.portal!.id!);
    const conf = com.find((c) => c.evento === "PROTOCOLO_RECEBIDO");
    expect(conf, "e-mail de confirmação").toBeTruthy();
    expect(["ENVIADA", "SIMULADA"]).toContain(conf!.status);
    expect(conf!.email!.para).toBe(`cidadao.${suf}@exemplo.demo`);
    expect(conf!.email!.assunto).toBe(`Protocolo ${e.portal!.numero} recebido`);
    expect(conf!.email!.corpo).toMatch(/Enviado em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2} \(horário de Brasília\)/);
    expect(conf!.email!.corpo).toContain(e.portal!.codigo);
    expect(conf!.email!.corpo).toContain(`/protocolo/${SLUG_A}/consulta?numero=${e.portal!.numero}`);
    expect(conf!.email!.corpo).toContain("Sem anexos");
    expect(conf!.email!.corpo).not.toMatch(/<a [^>]*href="[^"]*\.pdf/i);
    expect(conf!.destinatario_mascarado).not.toContain(`cidadao.${suf}`);
    expect(conf!.email!.corpo).not.toContain(CPF_VALIDO);

    // servidor1 (Protocolo/Licitações): analisa (não avisa) e responde (avisa) com texto público
    const tk = await tokenCache(request, A.servidor1);
    let r = await request.post(`/api/v1/ged/protocolos/${e.portal!.id}`, { headers: auth(tk), data: { acao: "ANALISAR" } });
    expect(r.status(), await r.text()).toBe(201);
    const resposta = `Documentos recebidos e aceitos (${suf}). Aguarde a convocação.`;
    r = await request.post(`/api/v1/ged/protocolos/${e.portal!.id}`, { headers: auth(tk), data: { acao: "RESPONDER", texto: resposta } });
    expect(r.status(), await r.text()).toBe(201);
    bancoCmd("processar");
    com = bancoCmd("protocolo-comunicacoes", e.portal!.id!);
    expect(com.filter((c) => c.evento === "PROTOCOLO_SITUACAO")).toHaveLength(1); // só a resposta notifica
    const sit = com.find((c) => c.evento === "PROTOCOLO_SITUACAO")!;
    expect(sit.email!.assunto).toBe(`Protocolo ${e.portal!.numero}: Respondido`);
    expect(sit.email!.corpo).toMatch(/Enviado em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2} \(horário de Brasília\)/);

    // consulta pública mostra a resposta (texto público), mas não o despacho interno
    await page.goto(`/protocolo/${SLUG_A}/consulta?numero=${e.portal!.numero}&codigo=${e.portal!.codigo}`);
    await expect(page.getByTestId("consulta-situacao")).toContainText("Respondido");
    await expect(page.getByTestId("consulta-andamento")).toContainText(resposta);
    await expect(page.getByTestId("consulta-andamento").locator("li")).toHaveCount(3);
  });

  test("T23e – verificação pública do comprovante (QR): autêntico, sem dados pessoais, hash conferido no navegador", async ({ page, request }) => {
    test.skip(!e.portal?.id, "depende de T23c");
    const f = await ficha(request, A.admin, e.portal!.id!);
    await page.goto(`/verificar/protocolo/${f.codigo_verificacao}`);
    await expect(page.getByTestId("status-verificacao")).toHaveText("AUTÊNTICO");
    await expect(page.getByTestId("numero-verificado")).toHaveText(e.portal!.numero);
    await expect(page.getByTestId("hash-comprovante")).toHaveText(f.comprovante.sha256!);
    const html = await page.locator("main").innerText();
    for (const proibido of [NOME_CIDADAO, "Joana", CPF_VALIDO, "52998224725", "habilitação", e.portal!.codigo]) expect(html).not.toContain(proibido);
    expect(html).toContain("Câmara Municipal de Vale das Acácias");
    expect(html).toContain("horário de Brasília");
    // PAdES do órgão (VAC tem certificado de TESTE): comprovante assinado
    expect(html).toMatch(/Assinatura digital PAdES do órgão íntegra/);

    // WebCrypto: o PDF baixado confere; um byte alterado, não
    await aguardarHidratacao(page).catch(() => undefined);
    await page.locator("#arquivo-conferir").setInputFiles({ name: "comprovante.pdf", mimeType: "application/pdf", buffer: e.portal!.comprovante });
    await expect(page.getByTestId("resultado-conferencia")).toHaveAttribute("data-resultado", "IGUAL");
    const alterado = Buffer.from(e.portal!.comprovante);
    alterado[alterado.length - 10] ^= 0xff;
    await page.locator("#arquivo-conferir").setInputFiles({ name: "alterado.pdf", mimeType: "application/pdf", buffer: alterado });
    await expect(page.getByTestId("resultado-conferencia")).toHaveAttribute("data-resultado", "DIFERENTE");

    // código inexistente ou mal formado: NÃO ENCONTRADO
    for (const ruim of ["AAAA-BBBB-CCCC", "xyz", "00000000-0000"]) {
      await page.goto(`/verificar/protocolo/${ruim}`);
      await expect(page.getByTestId("status-verificacao")).toHaveText("NÃO ENCONTRADO");
    }
    // o código de CONSULTA não serve como código de verificação
    await page.goto(`/verificar/protocolo/${e.portal!.codigo}`);
    await expect(page.getByTestId("status-verificacao")).toHaveText("NÃO ENCONTRADO");
  });

  test("T23f – registro imutável no banco: identidade, andamento e anexos não mudam nem são excluídos", async () => {
    test.skip(!temBanco(), "Sem DATABASE_URL.");
    test.skip(!e.portal?.id, "depende de T23c");
    const r = bancoCmd<Record<string, string | null>>("imutavel-protocolo", e.portal!.id!);
    for (const campo of ["assunto", "numero", "data", "codigo", "interessado", "exclusao", "comprovante", "evento_update", "evento_delete", "anexo_update", "anexo_delete"]) {
      expect(r[campo], `${campo} deveria ser recusado pelo banco`).toBeTruthy();
    }
    expect(r.assunto).toMatch(/imutáveis/);
    expect(r.exclusao).toMatch(/não pode ser excluído/);
    expect(r.comprovante).toMatch(/imutáveis|imutável/);
    expect(r.evento_update).toMatch(/imutável/i);
    expect(r.situacao_permitida).toBeNull(); // a situação (andamento) pode variar
  });

  test("T23g – permissões: Leitor e Auditor só leem; Usuário vê só o que o envolve; Admin e Gestor veem tudo", async ({ page, request }) => {
    test.skip(!e.balcao, "depende de T23a");
    const livroDe = async (email: string, q?: string) => {
      const r = await request.get(`/api/v1/ged/protocolos${q ? `?q=${encodeURIComponent(q)}` : ""}`, { headers: auth(await tokenCache(request, email)) });
      expect(r.status()).toBe(200);
      return itensDe(await r.json());
    };
    // Leitor (vereador): não registra, não movimenta; sem setor/envolvimento não vê nada
    const tkV = await tokenCache(request, A.vereador);
    let r = await request.post("/api/v1/ged/protocolos", { headers: auth(tkV), data: { livro: "INTERNO", assunto: "Tentativa do leitor", origem_setor_id: ids.A.setores["PROT"], destino_setor_id: ids.A.setores["LIC"] } });
    expect(r.status()).toBe(403);
    expect((await livroDe(A.vereador)).length).toBe(0);
    r = await request.get(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tkV) });
    expect(r.status()).toBe(404);
    // Auditor (Controle Interno): vê o livro todo, não movimenta
    const tkAud = await tokenCache(request, A.auditor);
    expect((await livroDe(A.auditor, e.suf)).length).toBeGreaterThanOrEqual(2);
    r = await request.post("/api/v1/ged/protocolos", { headers: auth(tkAud), data: { livro: "INTERNO", assunto: "Tentativa do auditor", origem_setor_id: ids.A.setores["CI"], destino_setor_id: ids.A.setores["LIC"] } });
    expect(r.status()).toBe(403);
    r = await request.post(`/api/v1/ged/protocolos/${e.balcao!.id}`, { headers: auth(tkAud), data: { acao: "ARQUIVAR" } });
    expect(r.status()).toBe(403);
    // Admin e Gestor veem as entradas do servidor1
    for (const quem of [A.admin, A.gestor]) expect((await livroDe(quem, e.suf)).length).toBeGreaterThanOrEqual(2);
    // Usuário de outro setor: servidor2 (Financeiro) não vê a SAÍDA de Licitações; vê a entrada que foi encaminhada ao seu setor
    expect((await livroDe(A.servidor2, `saída ${e.suf}`)).length).toBe(0);
    r = await request.get(`/api/v1/ged/protocolos/${e.saida!.id}`, { headers: auth(await tokenCache(request, A.servidor2)) });
    expect(r.status()).toBe(404);
    // a interface do Auditor não oferece "Novo protocolo" nem ações
    await loginGed(page, A.auditor);
    await irPara(page, "/ged/protocolo");
    await expect(page.getByRole("link", { name: "Novo protocolo" })).toHaveCount(0);
    await irPara(page, `/ged/protocolo/${e.balcao!.id}`);
    await expect(page.getByText("você pode consultar este protocolo, mas não movimentá-lo", { exact: false })).toBeVisible();
    // o comprovante também respeita a visibilidade
    r = await request.get(`/api/v1/ged/protocolos/${e.saida!.id}/comprovante`, { headers: auth(await tokenCache(request, A.servidor2)) });
    expect(r.status()).toBe(404);
  });

  test("T23h – isolamento: o portal de AAC está desligado (404), slug inexistente = 404 e a consulta nunca cruza clientes", async ({ page, request }) => {
    const h = { "x-forwarded-for": ipFalso() };
    for (const url of [`/protocolo/${SLUG_B}`, `/protocolo/${SLUG_B}/consulta`, "/protocolo/nao-existe-xyz", "/protocolo/nao-existe-xyz/consulta"]) {
      const r = await page.goto(url);
      expect(r?.status(), url).toBe(404);
    }
    let r = await request.get(`/api/v1/publico/protocolo/${SLUG_B}`, { headers: h });
    expect(r.status()).toBe(404);
    r = await request.post(`/api/v1/publico/protocolo/${SLUG_B}`, { headers: h, multipart: { nome: "Teste" } });
    expect(r.status()).toBe(404);
    r = await request.get("/api/v1/publico/protocolo/nao-existe-xyz", { headers: h });
    expect(r.status()).toBe(404);
    // slug mal formado (tentativa de injeção/travessia)
    for (const ruim of ["..%2F..%2Fged", "A_B", "%27%20OR%201%3D1"]) {
      r = await request.get(`/api/v1/publico/protocolo/${ruim}`, { headers: h });
      expect(r.status(), ruim).toBe(404);
    }
    // PROT-ENT-…-000001 existe nos DOIS clientes (numeração por cliente): o número de A com o código de B não consulta nada em A
    const pa = Object.values(ids.A.protocolos ?? {}).find((p) => p.livro === "ENTRADA" && p.numero.endsWith("-000001"));
    const pb = Object.values(ids.B.protocolos ?? {}).find((p) => p.livro === "ENTRADA" && p.numero.endsWith("-000001"));
    test.skip(!pa || !pb, "seed sem os protocolos de demonstração");
    expect(pa!.numero).toBe(pb!.numero);
    r = await request.post(`/api/v1/publico/protocolo/${SLUG_A}/consulta`, { headers: h, data: { numero: pa!.numero, codigo: pb!.codigo_consulta } });
    expect(r.status()).toBe(404);
    r = await request.post(`/api/v1/publico/protocolo/${SLUG_A}/consulta`, { headers: h, data: { numero: pa!.numero, codigo: pa!.codigo_consulta } });
    expect(r.status()).toBe(200);
    const corpo = JSON.stringify(await r.json());
    semVazamento(corpo, marcasDe(ids.B), "consulta pública de A");
    for (const proibido of ["Marina", "529.982.247-25", "52998224725", "marina.teixeira", ids.A.protocolos ? pa!.id : "", pa!.codigo_verificacao]) if (proibido) expect(corpo).not.toContain(proibido);
    expect(corpo).toContain(pa!.numero);
    // a verificação do comprovante de A pelo código de B não existe
    await page.goto(`/verificar/protocolo/${pb!.codigo_consulta}`);
    await expect(page.getByTestId("status-verificacao")).toHaveText("NÃO ENCONTRADO");
  });

  test("T23i – anti-abuso: honeypot não cria nada; limite por IP (429) nos envios e nas consultas; cabeçalhos sem cache/indexação", async ({ request }) => {
    const h = { "x-forwarded-for": ipFalso() };
    const total = async () => {
      const r = await request.get("/api/v1/ged/protocolos?size=1", { headers: auth(await tokenCache(request, A.admin)) });
      return (await r.json()).total as number;
    };
    const antes = await total();
    // honeypot preenchido: resposta de sucesso genérica, sem número, e NADA é criado
    let r = await request.post(`/api/v1/publico/protocolo/${SLUG_A}`, {
      headers: h,
      multipart: { nome: "Robô Spammer", cpf_cnpj: CPF_VALIDO, email: "robo@exemplo.demo", assunto_id: "00000000-0000-4000-8000-000000000000", descricao: "Mensagem automática de spam para o portal.", aceite_lgpd: "true", website: "http://spam.exemplo" },
    });
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ recebido: true });
    expect(await total()).toBe(antes);
    // erros de validação não expõem estrutura interna e não criam nada
    r = await request.post(`/api/v1/publico/protocolo/${SLUG_A}`, { headers: h, multipart: { nome: "Fulano de Tal", cpf_cnpj: "123", email: "x", assunto_id: "x", descricao: "curto" } });
    expect(r.status()).toBe(422);
    expect(r.headers()["x-robots-tag"]).toContain("noindex");
    expect(r.headers()["cache-control"]).toContain("no-store");
    expect(await total()).toBe(antes);
    // arquivo que não é PDF
    r = await request.post(`/api/v1/publico/protocolo/${SLUG_A}`, {
      headers: h,
      multipart: { nome: "Fulano de Tal", cpf_cnpj: CPF_VALIDO, email: "fulano@exemplo.demo", assunto_id: "00000000-0000-4000-8000-000000000000", descricao: "Documento com extensão enganosa para o teste.", aceite_lgpd: "true", arquivos: { name: "malicioso.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ não sou um PDF") } },
    });
    expect([422, 404]).toContain(r.status());
    expect(await total()).toBe(antes);
    // limite por IP: a partir da 9ª tentativa na hora (padrão 8) → 429, mesmo com dados inválidos
    let barrado = 0;
    for (let i = 0; i < 12; i++) {
      const x = await request.post(`/api/v1/publico/protocolo/${SLUG_A}`, { headers: h, multipart: { nome: "x" } });
      if (x.status() === 429) {
        barrado++;
        expect((await x.json()).code).toBe("MUITAS_TENTATIVAS");
      }
    }
    expect(barrado).toBeGreaterThanOrEqual(1);
    // outro IP continua atendido
    r = await request.post(`/api/v1/publico/protocolo/${SLUG_A}`, { headers: { "x-forwarded-for": ipFalso() }, multipart: { nome: "x" } });
    expect(r.status()).toBe(422);
    // consulta: chutar códigos bloqueia o IP (429) sem revelar qual campo errou
    const hc = { "x-forwarded-for": ipFalso() };
    const pa = Object.values(ids.A.protocolos ?? {}).find((p) => p.livro === "ENTRADA");
    let bloqueou = false;
    for (let i = 0; i < 14; i++) {
      const x = await request.post(`/api/v1/publico/protocolo/${SLUG_A}/consulta`, { headers: hc, data: { numero: pa?.numero ?? "PROT-ENT-2026-000001", codigo: `AAAA-BBBB-${String(1000 + i).replace(/[01]/g, "2")}` } });
      if (x.status() === 429) { bloqueou = true; break; }
      expect(x.status()).toBe(404);
      expect((await x.json()).message).toContain("Confira o número e o código");
    }
    expect(bloqueou).toBe(true);
  });

  test("T23j – administrador liga e desliga o protocolo online em Configurações (recurso nasce desligado)", async ({ page }) => {
    aceitarDialogos(page);
    // Gestor não administra: 403
    await loginGed(page, B.gestor);
    const negado = await page.goto("/ged/admin/configuracoes");
    expect(negado?.status()).toBe(403);
    await page.goto("/sair");

    await loginGed(page, B.admin);
    await irPara(page, "/ged/admin/configuracoes");
    await expect(page.getByRole("heading", { name: /Protocolo online/ })).toBeVisible();
    await expect(page.getByTestId("assuntos-protocolo")).toContainText("Solicitação de serviço de água e esgoto");
    const toggle = page.getByTestId("portal-ativo");
    await expect(toggle).not.toBeChecked(); // desligado por padrão
    const form = page.getByRole("form", { name: "Configuração do protocolo online" });
    const resp = await page.goto(`/protocolo/${SLUG_B}`);
    expect(resp?.status()).toBe(404);

    await irPara(page, "/ged/admin/configuracoes");
    await toggle.check();
    await page.locator("#pt-orient").fill(`Orientação de teste ${e.suf}`);
    await submeter(page, form.getByRole("button", { name: "Salvar protocolo online" }), "Configuração do protocolo online salva.", form);
    const ligado = await page.goto(`/protocolo/${SLUG_B}`);
    expect(ligado?.status()).toBe(200);
    await expect(page.getByTestId("portal-orientacao")).toContainText(`Orientação de teste ${e.suf}`);
    await expect(page.getByTestId("portal-orgao")).toContainText("Águas do Cerrado");

    // endereço de outro órgão não pode ser usado
    await irPara(page, "/ged/admin/configuracoes");
    await page.locator("#pt-slug").fill(SLUG_A);
    await submeter(page, form.getByRole("button", { name: "Salvar protocolo online" }), /já está em uso/, form);
    await page.reload();
    await expect(page.locator("#pt-slug")).toHaveValue(SLUG_B);

    // desliga de volta
    await page.getByTestId("portal-ativo").uncheck();
    await submeter(page, form.getByRole("button", { name: "Salvar protocolo online" }), "Configuração do protocolo online salva.", form);
    const desligado = await page.goto(`/protocolo/${SLUG_B}`);
    expect(desligado?.status()).toBe(404);
  });
});

