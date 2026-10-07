import { test, expect } from "@playwright/test";
import { USUARIOS_GED, aceitarDialogos, aguardarHidratacao, auth, carregarIdsGed, criarDocumentoApi, gerarPdf, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, sufixoUnico, submeter, temPdftotext, tokenCache } from "./ged-helpers";

// T17 – GED: documentos, filtros, busca por conteúdo, marcadores, pastas e permissões (itens 1, 3 e 4 do edital).
// Dados: seed `E2E_GED_IDS=1 npm run seed:ged-demo` (VAC/AAC). Cada execução cria dados com sufixo único (re-executável).
// Desktop apenas (altera dados).

test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const ids = IDS!;
const A = USUARIOS_GED.A;
test.describe.configure({ timeout: 120_000 });

test("T17a – upload de PDF, filtros (título, remetente, data, marcador, pasta) e busca por conteúdo com trecho; outro cliente não encontra", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const palavra = `zeppelin${suf.replace(/[^a-z0-9]/g, "")}`;
  const titulo = `Ofício T17 ${suf}`;
  const remetente = `Remetente T17 ${suf}`;
  const pdf = await gerarPdf([`Documento de ensaio ${suf}`, `A palavra distintiva é ${palavra} e só aparece aqui.`]);

  await loginGed(page, A.servidor1);
  await irPara(page, "/ged/documentos/novo");
  await page.locator("#arquivo").setInputFiles({ name: `oficio-t17-${suf}.pdf`, mimeType: "application/pdf", buffer: pdf });
  await page.locator("#titulo").fill(titulo);
  await page.locator("#remetente").fill(remetente);
  await page.locator("#data_documento").fill("2026-03-15");
  await page.locator("#pasta_id").selectOption({ label: "Documentação da licitação/Propostas" });
  await page.getByText("Urgente", { exact: true }).click(); // marcador (chip)
  await aguardarHidratacao(page);
  await page.getByRole("button", { name: "Enviar documento" }).click();
  await expect(page).toHaveURL(/\/ged\/documentos\/[0-9a-f-]{36}$/, { timeout: 40_000 });
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  const docId = page.url().split("/").pop()!;

  // Filtros (formulário GET: a URL é o estado)
  const ref = await request.get(`/api/v1/ged/documentos/${docId}`, { headers: auth(await tokenCache(request, A.servidor1)) });
  const marcadores = (await ref.json()).marcadores as { id: string; nome: string }[];
  expect(marcadores.map((m) => m.nome)).toContain("Urgente");
  const pastaId = ids.A.pastas["Documentação da licitação/Propostas"];
  const casos: [string, boolean][] = [
    [`titulo=${encodeURIComponent(`T17 ${suf}`)}`, true],
    [`remetente=${encodeURIComponent(suf)}`, true],
    [`titulo=${encodeURIComponent(`T17 ${suf}`)}&de=2026-03-01&ate=2026-03-31`, true],
    [`titulo=${encodeURIComponent(`T17 ${suf}`)}&de=2026-04-01`, false],
    [`titulo=${encodeURIComponent(`T17 ${suf}`)}&marcador=${marcadores.find((m) => m.nome === "Urgente")!.id}`, true],
    [`titulo=${encodeURIComponent(`T17 ${suf}`)}&pasta=${pastaId}`, true],
    [`titulo=${encodeURIComponent(`T17 ${suf}`)}&pasta=${ids.A.pastas["Controle interno"]}`, false],
    [`remetente=${encodeURIComponent("inexistente-" + suf)}`, false],
  ];
  for (const [qs, deveAparecer] of casos) {
    await page.goto(`/ged/documentos?${qs}`);
    const item = page.getByTestId("documento-item").filter({ hasText: titulo });
    if (deveAparecer) await expect(item, qs).toHaveCount(1);
    else await expect(item, qs).toHaveCount(0);
  }
  // Pela interface: preencher o título e filtrar
  await irPara(page, "/ged/documentos");
  await page.getByText("Filtros avançados").click();
  await page.getByLabel("Título", { exact: true }).fill(titulo);
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByTestId("documento-item").filter({ hasText: titulo })).toHaveCount(1);

  // Conteúdo: a palavra só existe dentro do PDF (extração via pdftotext)
  if (temPdftotext()) {
    await expect
      .poll(async () => {
        await page.goto(`/ged/documentos?q=${palavra}`);
        return page.getByTestId("documento-item").filter({ hasText: titulo }).count();
      }, { timeout: 60_000, intervals: [1500, 3000] })
      .toBe(1);
    await expect(page.getByTestId("snippet").locator("mark").first()).toContainText(palavra, { ignoreCase: true });
    // Outro cliente (AAC): mesma palavra, nada
    const b = await request.get(`/api/v1/ged/busca?q=${palavra}`, { headers: auth(await tokenCache(request, USUARIOS_GED.B.admin)) });
    expect(b.status()).toBe(200);
    expect(itensDe(await b.json())).toHaveLength(0);
  } else test.info().annotations.push({ type: "aviso", description: "pdftotext ausente: busca por conteúdo de upload não verificada (a do seed sim, em t16)." });
});

test("T17b – marcadores: criar com cor, renomear, aplicar ao documento, filtrar e excluir", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const nome = `Marc ${suf}`;
  const novo = `Marc2 ${suf}`;
  const h = auth(await tokenCache(request, A.gestor));
  const doc = await criarDocumentoApi(request, h.Authorization.slice(7), { titulo: `Doc marcador ${suf}`, pasta_id: ids.A.pastas["Documentação da licitação/Propostas"] });

  await loginGed(page, A.gestor);
  await irPara(page, "/ged/admin/marcadores");
  await page.locator("#m-nome").fill(nome);
  await page.locator("#m-cor").fill("#f59e0b");
  await submeter(page, page.getByRole("button", { name: "Criar marcador" }), "Marcador criado.");
  await expect(page.getByRole("form", { name: `Editar marcador ${nome}` })).toBeVisible({ timeout: 15_000 });
  // renomear
  await page.getByRole("form", { name: `Editar marcador ${nome}` }).getByLabel("Nome").fill(novo);
  await submeter(page, page.getByRole("form", { name: `Editar marcador ${nome}` }).getByRole("button", { name: "Salvar" }), "Marcador atualizado.");
  await page.reload();
  await expect(page.getByRole("form", { name: `Editar marcador ${novo}` })).toBeVisible();

  // aplicar ao documento
  await irPara(page, `/ged/documentos/${doc.id}`);
  const form = page.getByRole("form", { name: "Marcadores do documento" });
  await form.getByText(novo, { exact: true }).click();
  await submeter(page, form.getByRole("button", { name: "Salvar marcadores" }), "Marcadores atualizados.");
  // filtrar pelo marcador
  const lista = await (await request.get("/api/v1/ged/marcadores", { headers: h })).json();
  const mid = (lista.data as { id: string; nome: string }[]).find((m) => m.nome === novo)!.id;
  await page.goto(`/ged/documentos?marcador=${mid}`);
  await expect(page.getByTestId("documento-item").filter({ hasText: `Doc marcador ${suf}` })).toHaveCount(1);
  await expect(page.getByTestId("documento-item")).toHaveCount(1);

  // excluir (confirmação aceita)
  await irPara(page, "/ged/admin/marcadores");
  await page.locator(`form[aria-label="Excluir marcador ${novo}"] button`).click(); // a confirmação (window.confirm) é aceita
  await expect(page.getByRole("form", { name: `Editar marcador ${novo}` })).toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole("form", { name: `Editar marcador ${novo}` })).toHaveCount(0);
});

test("T17c – pastas: criar na raiz, criar subpasta e mover", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const raiz = `T17 Raiz ${suf}`;
  const sub = `T17 Sub ${suf}`;
  const h = auth(await tokenCache(request, A.admin));
  await loginGed(page, A.admin);
  await irPara(page, "/ged/pastas");
  await page.locator("#raiz-nome").fill(raiz);
  await aguardarHidratacao(page);
  await page.getByRole("button", { name: "Criar pasta" }).click();
  await expect(page).toHaveURL(/\/ged\/pastas\?pasta=/, { timeout: 20_000 }); // criar redireciona para a pasta nova
  const achar = async (nome: string) => {
    const r = await request.get("/api/v1/ged/pastas", { headers: h });
    return (((await r.json()).data as { id: string; nome: string; parent_id: string | null; caminho_nome: string }[]).find((p) => p.nome === nome))!;
  };
  const pRaiz = await achar(raiz);
  expect(pRaiz.parent_id).toBeNull();

  await irPara(page, `/ged/pastas?pasta=${pRaiz.id}`);
  await page.locator("#sub-nome").fill(sub);
  await aguardarHidratacao(page);
  await page.getByRole("button", { name: "Criar subpasta" }).click();
  await expect(page).not.toHaveURL(new RegExp(`pasta=${pRaiz.id}$`), { timeout: 20_000 });
  const pSub = await achar(sub);
  expect(pSub.parent_id).toBe(pRaiz.id);
  expect(pSub.caminho_nome).toBe(`${raiz}/${sub}`);

  // mover a subpasta para a raiz
  await irPara(page, `/ged/pastas?pasta=${pSub.id}`);
  await page.locator("#mov-pai").selectOption("");
  await submeter(page, page.getByRole("button", { name: "Mover pasta" }), "Pasta movida.");
  await expect.poll(async () => (await achar(sub)).caminho_nome, { timeout: 15_000 }).toBe(sub);
  expect((await achar(sub)).parent_id).toBeNull();
});

test("T17d – permissões: conceder Ver/Editar/Assinar a usuários diferentes e conferir a visão de cada um; sigiloso não aparece ao Administrador", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const tk1 = await tokenCache(request, A.servidor1);
  const doc = await criarDocumentoApi(request, tk1, { titulo: `Doc ACL ${suf}`, sensibilidade: "RESTRITO" }); // sem pasta: só o autor e administradores
  const tkS2 = await tokenCache(request, A.servidor2);
  const tkVer = await tokenCache(request, A.vereador);
  const tkAud = await tokenCache(request, A.auditor);
  const get = async (tk: string) => (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tk) })).status();

  expect(await get(tkS2)).toBe(404); // sem permissão: nem sabe que existe
  expect(await get(tkVer)).toBe(404);
  expect(await get(tkAud)).toBe(404);

  // Administrador concede VER a servidor2 pela tela
  await loginGed(page, A.admin);
  await irPara(page, `/ged/documentos/${doc.id}?aba=permissoes`);
  const painel = page.getByTestId("acl-painel");
  await painel.getByLabel("Usuário ou setor").selectOption({ label: "Antônio Barros Medeiros (Usuário)" });
  await submeter(page, painel.getByRole("button", { name: "Conceder permissão" }), "Permissão concedida.");
  await expect(painel.getByRole("table").getByText("Antônio Barros Medeiros")).toBeVisible();
  expect(await get(tkS2)).toBe(200);
  const v1 = await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tkS2) })).json();
  expect(v1.acoes).toContain("VER");
  expect(v1.acoes).not.toContain("EDITAR");

  // EDITAR a servidor2 e ASSINAR ao vereador (pela API, mesma regra de serviço)
  const adm = await tokenCache(request, A.admin);
  const conceder = (usuario: string, acoes: string[]) => request.post("/api/v1/ged/acl", { headers: auth(adm), data: { alvo: { tipo: "documento", id: doc.id }, principal: { tipo: "USUARIO", id: usuario }, acoes } });
  expect((await conceder(ids.A.usuarios[A.servidor2], ["VER", "EDITAR"])).ok()).toBeTruthy();
  expect((await conceder(ids.A.usuarios[A.vereador], ["VER", "ASSINAR"])).ok()).toBeTruthy();
  const v2 = await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tkS2) })).json();
  expect(v2.acoes).toEqual(expect.arrayContaining(["VER", "EDITAR"]));
  const v3 = await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tkVer) })).json();
  expect(v3.acoes).toEqual(expect.arrayContaining(["VER", "ASSINAR"]));
  expect(v3.acoes).not.toContain("EDITAR");
  expect(await get(tkAud)).toBe(404); // continua sem acesso

  // Visão de cada um na tela: quem edita vê "Editar informações"; quem só assina não vê
  await page.goto("/sair");
  await loginGed(page, A.servidor2);
  await page.goto(`/ged/documentos/${doc.id}`);
  await expect(page.getByText("Editar informações")).toBeVisible();
  await page.goto("/sair");
  await loginGed(page, A.vereador);
  await page.goto(`/ged/documentos/${doc.id}`);
  await expect(page.getByRole("heading", { name: `Doc ACL ${suf}` })).toBeVisible();
  await expect(page.getByText("Editar informações")).toHaveCount(0);

  // SIGILOSO (semente): o administrador NÃO vê sem ACL explícita; quem recebeu ACL vê
  const pad = ids.A.documentos.pad003.id;
  expect((await request.get(`/api/v1/ged/documentos/${pad}`, { headers: auth(adm) })).status()).toBe(404);
  expect((await request.get(`/api/v1/ged/documentos/${pad}`, { headers: auth(tkS2) })).status()).toBe(200);
  expect((await request.get(`/api/v1/ged/documentos/${pad}`, { headers: auth(tkAud) })).status()).toBe(200);
  const lista = await (await request.get("/api/v1/ged/documentos?size=100", { headers: auth(adm) })).json();
  expect(itensDe(lista).map((d) => d.id)).not.toContain(pad);
  // administrador também não consegue conceder ACL no sigiloso (nem enxerga o documento)
  const tentativa = await request.post("/api/v1/ged/acl", { headers: auth(adm), data: { alvo: { tipo: "documento", id: pad }, principal: { tipo: "USUARIO", id: ids.A.usuarios[A.servidor1] }, acoes: ["VER"] } });
  expect([403, 404]).toContain(tentativa.status());
});

test("T17e – marcar 'contém dados pessoais' num documento público o torna Restrito com anonimização pendente", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const tk = await tokenCache(request, A.gestor);
  const doc = await criarDocumentoApi(request, tk, { titulo: `Doc LGPD ${suf}`, sensibilidade: "PUBLICO", pasta_id: ids.A.pastas["Documentação da licitação/Editais"] });
  const antes = await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tk) })).json();
  expect(antes.sensibilidade).toBe("PUBLICO");

  await loginGed(page, A.gestor);
  await irPara(page, `/ged/documentos/${doc.id}`);
  await submeter(page, page.getByRole("button", { name: "Marcar como contendo dados pessoais" }), /Marcado\. A sensibilidade/, page.locator("main"));
  await expect.poll(async () => (await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tk) })).json()).sensibilidade, { timeout: 15_000 }).toBe("RESTRITO");
  const depois = await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tk) })).json();
  expect(depois.contem_dados_pessoais).toBe(true);
  expect(depois.anonimizacao_status).toBe("PENDENTE");
  await page.reload();
  await expect(page.getByText("Contém dados pessoais – anonimização pendente").first()).toBeVisible();
});
