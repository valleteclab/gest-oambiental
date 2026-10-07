import { test, expect } from "@playwright/test";
import { USUARIOS_GED, aceitarDialogos, aguardarHidratacao, auth, bancoCmd, carregarIdsGed, criarDocumentoApi, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, sufixoUnico, submeter, temBanco, tokenCache } from "./ged-helpers";

// T18 – GED: editor de texto (rascunho com autosave → PDF), trâmite (envio → caixa de entrada → ciência → devolução → arquivamento),
// linha do tempo imutável e comentários (itens 2, 7 e 9 do edital). Desktop apenas (altera dados). Re-executável (sufixo único).

test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const A = USUARIOS_GED.A;
test.describe.configure({ timeout: 150_000 });

test("T18a – editor: criar, autosave do rascunho, finalizar gera o PDF (nova versão) e o texto fica pesquisável", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const titulo = `Ofício do editor ${suf}`;
  const palavra = `quimera${suf.replace(/[^a-z0-9]/g, "")}`;
  await loginGed(page, A.servidor1);
  await irPara(page, "/ged/editor/novo");
  await page.locator("#titulo").fill(titulo);
  await page.locator("#remetente").fill("Gabinete (ensaio)");
  await aguardarHidratacao(page);
  await page.getByRole("button", { name: "Criar e abrir o editor" }).click();
  await expect(page).toHaveURL(/\/ged\/editor\/[0-9a-f-]{36}$/, { timeout: 40_000 });
  const docId = page.url().split("/").pop()!;

  const editor = page.getByRole("textbox", { name: "Conteúdo do documento" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await aguardarHidratacao(page);
  await editor.click();
  await page.keyboard.type(`Senhores, encaminhamos o assunto ${palavra} para deliberação.`);
  const estado = page.getByTestId("estado-autosave");
  await expect(estado).toContainText(/Rascunho salvo às/, { timeout: 30_000 });

  // o rascunho persiste (recarregar a página mantém o texto)
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Conteúdo do documento" })).toContainText(palavra, { timeout: 30_000 });

  // finalizar → PDF
  await aguardarHidratacao(page);
  await page.getByTestId("finalizar").click();
  await expect(page).toHaveURL(new RegExp(`/ged/documentos/${docId}$`), { timeout: 60_000 });
  const tk = await tokenCache(request, A.servidor1);
  const d = await (await request.get(`/api/v1/ged/documentos/${docId}`, { headers: auth(tk) })).json();
  expect(d.versoes.length).toBeGreaterThanOrEqual(1);
  const v = d.versoes[0];
  expect(v.origem).toBe("EDITOR");
  expect(v.mime).toBe("application/pdf");
  const arq = await request.get(`/api/v1/ged/documentos/${docId}/arquivo?versao=${v.id}`, { headers: auth(tk) });
  expect(arq.status()).toBe(200);
  expect((await arq.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // texto indexado direto (origem editor): a busca por conteúdo acha
  await expect
    .poll(async () => itensDe(await (await request.get(`/api/v1/ged/busca?q=${palavra}`, { headers: auth(tk) })).json()).length, { timeout: 40_000, intervals: [1500, 3000] })
    .toBeGreaterThan(0);
});

test("T18b – trâmite: enviar, caixa de entrada, ciência, comentário, devolução e arquivamento; linha do tempo imutável", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const titulo = `Doc trâmite ${suf}`;
  const tk1 = await tokenCache(request, A.servidor1);
  const doc = await criarDocumentoApi(request, tk1, { titulo });

  // 1) servidor1 envia a servidor2
  await loginGed(page, A.servidor1);
  await irPara(page, `/ged/documentos/${doc.id}?aba=tramite`);
  await page.getByText("Enviar a um usuário ou setor").click();
  const sel = page.getByLabel("Destinatário *");
  const valor = await sel.locator("option", { hasText: "Antônio Barros Medeiros" }).getAttribute("value");
  await sel.selectOption(valor!);
  await page.getByRole("textbox", { name: /^Despacho/ }).first().fill(`Para análise ${suf}`);
  await submeter(page, page.getByRole("button", { name: "Enviar", exact: true }), "Documento enviado.");
  await expect(page.getByTestId("posse-atual")).toContainText("Antônio Barros Medeiros");

  // 2) servidor2: caixa de entrada com ciência pendente → ciência → comentário → devolução
  await page.goto("/sair");
  await loginGed(page, A.servidor2);
  await irPara(page, "/ged/tramite");
  const item = page.getByTestId("caixa-entrada").locator("li").filter({ hasText: titulo });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Ciência pendente");
  await item.getByRole("link", { name: titulo }).click();
  await aguardarHidratacao(page);
  await aguardarHidratacao(page);
  await page.getByRole("button", { name: "Registrar ciência" }).click(); // o painel some depois de registrar: confere pela linha do tempo
  await expect(page.getByTestId("linha-do-tempo").locator('li[data-tipo="CIENCIA"]')).toHaveCount(1, { timeout: 20_000 });

  await irPara(page, `/ged/documentos/${doc.id}?aba=comentarios`);
  await page.getByRole("textbox", { name: "Novo comentário" }).fill(`Recebido e conferido ${suf}`);
  await submeter(page, page.getByRole("button", { name: "Publicar comentário" }), "Comentário publicado.");
  await expect(page.getByTestId("lista-comentarios")).toContainText(`Recebido e conferido ${suf}`, { timeout: 20_000 });
  // comentários não têm ação de editar/excluir
  await expect(page.getByTestId("lista-comentarios").getByRole("button")).toHaveCount(0);

  await irPara(page, `/ged/documentos/${doc.id}?aba=tramite`);
  await page.getByText("Devolver ao remetente anterior").click();
  await page.getByRole("textbox", { name: "Motivo da devolução *" }).fill(`Devolvido ${suf}`);
  await aguardarHidratacao(page);
  await page.getByRole("button", { name: "Devolver", exact: true }).click();
  // devolvido: servidor2 perde o acesso (sem ACL nem trâmite) e a página passa a "não encontrado"
  await expect(page.getByText(/could not be found|não encontrad/i).first()).toBeVisible({ timeout: 20_000 });
  expect((await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(await tokenCache(request, A.servidor2)) })).status()).toBe(404);

  // 3) servidor1: o documento volta à caixa de entrada; vê o comentário; arquiva
  await page.goto("/sair");
  await loginGed(page, A.servidor1);
  await irPara(page, "/ged/tramite");
  await expect(page.getByTestId("caixa-entrada").locator("li").filter({ hasText: titulo })).toHaveCount(1);
  await irPara(page, `/ged/documentos/${doc.id}?aba=comentarios`);
  await expect(page.getByTestId("lista-comentarios")).toContainText(`Recebido e conferido ${suf}`);
  await irPara(page, `/ged/documentos/${doc.id}?aba=tramite`);
  await page.getByText("Arquivar", { exact: true }).click();
  await page.getByRole("textbox", { name: "Motivo do arquivamento" }).fill(`Concluído ${suf}`);
  await aguardarHidratacao(page);
  await page.getByRole("button", { name: "Arquivar documento" }).click();
  await expect(page.getByTestId("linha-do-tempo").locator('li[data-tipo="ARQUIVAMENTO"]')).toHaveCount(1, { timeout: 20_000 });

  // 4) linha do tempo: ENVIO, CIENCIA, DEVOLUCAO, ARQUIVAMENTO (mais recente primeiro), sem controles de edição
  await page.reload();
  const tipos = await page.getByTestId("linha-do-tempo").locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-tipo")));
  expect(tipos).toEqual(["ARQUIVAMENTO", "DEVOLUCAO", "CIENCIA", "ENVIO"]);
  await expect(page.getByTestId("linha-do-tempo").getByRole("button")).toHaveCount(0);
  const d = await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tk1) })).json();
  expect(d.status).toBe("ARQUIVADO");
  // sem trâmite novo em documento arquivado
  const r = await request.post(`/api/v1/ged/tramite/${doc.id}`, { headers: auth(tk1), data: { acao: "DESPACHAR", despacho: "tentativa" } });
  expect(r.ok()).toBeFalsy();
});

test("T18c – a trilha de trâmite e os comentários são imutáveis no banco (UPDATE/DELETE recusados)", async () => {
  test.skip(!temBanco(), "Sem DATABASE_URL (ambiente remoto): verificação direta no banco não se aplica.");
  const r = bancoCmd<{ tramite: string | null; comentario: string | null }>("imutavel");
  expect(r.tramite, "UPDATE em ged_tramite deve falhar").toBeTruthy();
  expect(r.comentario, "UPDATE em ged_comentario deve falhar").toBeTruthy();
});
