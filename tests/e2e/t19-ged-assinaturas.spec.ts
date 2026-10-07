import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { USUARIOS_GED, aceitarDialogos, aguardarHidratacao, auth, carregarIdsGed, criarDocumentoApi, gerarPdf, irPara, loginGed, MOTIVO_SEM_IDS, sufixoUnico, submeter, temPdftotext, tokenCache } from "./ged-helpers";

// T19 – GED: assinaturas (solicitação sequencial com 2 signatários, ordem, comentário, senha errada, recusa com justificativa,
// painel por status), PDF selado com QR em cada página e a verificação PÚBLICA /verificar/{codigo} (itens 8, 9, 10 e 12).
// Desktop apenas (altera dados). A parte "selado" usa "Termo de Cooperação 005/2026" do seed (assinado pelo serviço real, certificado de TESTE).

test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const ids = IDS!;
const A = USUARIOS_GED.A;
test.describe.configure({ timeout: 180_000 });

async function sair(page: Page) {
  await page.goto("/sair");
}

test("T19a – fluxo sequencial: solicitar (ordem), comentar, senha errada, vereador assina, gestor assina, selo com código", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const titulo = `Contrato de ensaio ${suf}`;
  const tk1 = await tokenCache(request, A.servidor1);
  const pdf = await gerarPdf([titulo, "Cláusula única: ensaio de assinatura eletrônica."]);
  const doc = await criarDocumentoApi(request, tk1, { titulo, pdf, pasta_id: ids.A.pastas["Documentação da licitação/Propostas"] });

  // 1) servidor1 solicita: vereador (1º) e gestor (2º), sequencial
  await loginGed(page, A.servidor1);
  await irPara(page, `/ged/documentos/${doc.id}?aba=assinaturas`);
  const form = page.getByRole("form", { name: "Solicitar assinatura" });
  await form.getByLabel("Buscar signatário por nome").fill("Carlos");
  await form.getByRole("button", { name: /^Adicionar Ver\. Carlos/ }).click();
  await form.getByLabel("Buscar signatário por nome").fill("Roberto");
  await form.getByRole("button", { name: /^Adicionar Roberto/ }).click();
  const escolhidos = form.getByTestId("signatarios-escolhidos").locator("li");
  await expect(escolhidos).toHaveCount(2);
  await expect(escolhidos.nth(0)).toContainText("Carlos Eduardo Tavares");
  await expect(escolhidos.nth(1)).toContainText("Roberto Cavalcante Neto");
  await form.getByLabel("Mensagem aos signatários (opcional)").fill(`Assinar até sexta ${suf}`);
  await aguardarHidratacao(page);
  await form.getByRole("button", { name: "Enviar para assinatura" }).click(); // o formulário some depois de enviar
  await expect(page.getByText("Solicitação em andamento")).toBeVisible({ timeout: 30_000 });
  const sig = page.getByTestId("aba-assinaturas").getByTestId("signatario");
  await expect(sig).toHaveCount(2);
  await expect(sig.nth(0)).toHaveAttribute("data-status", "PENDENTE");
  await expect(sig.nth(1)).toHaveAttribute("data-status", "AGUARDANDO");

  // 2) comentário do autor na solicitação
  await page.getByRole("textbox", { name: "Novo comentário" }).fill(`Revisado pelo jurídico ${suf}`);
  await submeter(page, page.getByRole("button", { name: "Comentar", exact: true }), "Comentário registrado.");
  const solId = (await page.getByRole("link", { name: "Abrir tela da assinatura" }).getAttribute("href"))!.split("/").pop()!;

  // 3) gestor (2º) ainda não pode assinar: fora da vez
  await sair(page);
  await loginGed(page, A.gestor);
  await irPara(page, `/ged/assinaturas/${solId}`);
  await expect(page.getByText("Ainda não é a sua vez")).toBeVisible();
  await expect(page.getByRole("button", { name: "Assinar documento" })).toHaveCount(0);

  // 4) vereador: painel "Aguardando minha assinatura" → senha errada → senha certa
  await sair(page);
  await loginGed(page, A.vereador);
  await irPara(page, "/ged/assinaturas?aba=aguardando");
  await expect(page.getByTestId("linha-assinatura").filter({ hasText: titulo })).toHaveCount(1);
  await page.getByTestId("linha-assinatura").filter({ hasText: titulo }).getByRole("link", { name: "Assinar" }).click();
  await aguardarHidratacao(page);
  await expect(page.getByText(`Revisado pelo jurídico ${suf}`)).toBeVisible(); // comentário visível ao signatário
  await page.locator('input[name="consentimento"]').check();
  await page.getByLabel("Confirme sua senha").fill("senha-errada-123");
  await page.getByRole("button", { name: "Assinar documento" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("signatario").first()).toHaveAttribute("data-status", "PENDENTE");
  await page.getByLabel("Confirme sua senha").fill("Demo@2026licencia");
  await page.getByRole("button", { name: "Assinar documento" }).click();
  await expect(page.getByText("Você assinou este documento em")).toBeVisible({ timeout: 30_000 });

  // 5) gestor assina → conclusão e selo
  await sair(page);
  await loginGed(page, A.gestor);
  await irPara(page, `/ged/assinaturas/${solId}`);
  await page.locator('input[name="consentimento"]').check();
  await page.getByLabel("Confirme sua senha").fill("Demo@2026licencia");
  await page.getByRole("button", { name: "Assinar documento" }).click();
  await expect(page.getByText("Você assinou este documento em")).toBeVisible({ timeout: 30_000 });

  // 6) selo: documento ASSINADO com código verificador
  await expect
    .poll(async () => (await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tk1) })).json()).status, { timeout: 90_000, intervals: [2000, 3000] })
    .toBe("ASSINADO");
  await sair(page);
  await loginGed(page, A.servidor1);
  await irPara(page, `/ged/documentos/${doc.id}?aba=assinaturas`);
  const codigo = (await page.getByTestId("codigo-verificador").textContent())!.trim();
  expect(codigo).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  // painel "Concluídas" do autor
  await irPara(page, "/ged/assinaturas?aba=concluidas");
  await expect(page.getByTestId("linha-assinatura").filter({ hasText: titulo })).toHaveCount(1);
  // os dois assinaram, na ordem
  await irPara(page, `/ged/documentos/${doc.id}?aba=assinaturas`);
  await expect(page.getByTestId("aba-assinaturas").getByTestId("signatario").first()).toHaveAttribute("data-status", "ASSINADO");
});

test("T19b – recusa com justificativa: mínimo de caracteres, registro no histórico e painel 'Recusadas'", async ({ page, request }) => {
  aceitarDialogos(page);
  const suf = sufixoUnico();
  const titulo = `Parecer a recusar ${suf}`;
  const tk1 = await tokenCache(request, A.servidor1);
  const doc = await criarDocumentoApi(request, tk1, { titulo, pdf: await gerarPdf([titulo]) });
  const r = await request.post("/api/v1/ged/assinaturas", { headers: auth(tk1), data: { documento_id: doc.id, signatarios: [ids.A.usuarios[A.vereador], ids.A.usuarios[A.gestor]], modo: "SEQUENCIAL", mensagem: "Para assinatura" } });
  expect(r.status(), await r.text()).toBe(201);
  const solId = (await r.json()).id as string;

  await loginGed(page, A.vereador);
  await irPara(page, `/ged/assinaturas/${solId}`);
  await page.getByText("Recusar assinatura", { exact: true }).first().click();
  const just = page.getByLabel("Justificativa (obrigatória)");
  await just.fill("curto");
  await page.getByRole("button", { name: "Recusar assinatura" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 }); // menos de 10 caracteres
  await just.fill(`Discordo da cláusula 3: valor sem dotação ${suf}`);
  await page.getByRole("button", { name: "Recusar assinatura" }).click();
  await expect(page.getByText("Você recusou a assinatura em")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Discordo da cláusula 3: valor sem dotação ${suf}`).first()).toBeVisible();

  // autor: documento RECUSADO, painel "Recusadas" e justificativa na aba do documento
  const d = await (await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(tk1) })).json();
  expect(d.status).toBe("RECUSADO");
  await sair(page);
  await loginGed(page, A.servidor1);
  await irPara(page, "/ged/assinaturas?aba=recusadas");
  await expect(page.getByTestId("linha-assinatura").filter({ hasText: titulo })).toHaveCount(1);
  await irPara(page, `/ged/documentos/${doc.id}?aba=assinaturas`);
  await expect(page.getByText(`Discordo da cláusula 3: valor sem dotação ${suf}`).first()).toBeVisible();
  await irPara(page, `/ged/documentos/${doc.id}?aba=tramite`);
  await expect(page.getByTestId("linha-do-tempo").locator('li[data-tipo="RECUSA"]')).toHaveCount(1);
});

test("T19c – PDF selado (seed): QR em todas as páginas, folha de assinaturas e verificação pública com WebCrypto (íntegro / 1 byte alterado / código inexistente)", async ({ request, browser }) => {
  const termo = ids.A.documentos.termo005;
  test.skip(!termo?.codigo_verificador, "O seed não gerou o documento assinado (certificado/Chromium indisponíveis).");
  const tk = await tokenCache(request, A.servidor1);
  const d = await (await request.get(`/api/v1/ged/documentos/${termo.id}`, { headers: auth(tk) })).json();
  expect(d.status).toBe("ASSINADO");
  const selada = (d.versoes as { id: string; origem: string; selada: boolean }[]).find((v) => v.selada)!;
  const original = (d.versoes as { id: string; n: number }[]).find((v) => v.n === 1)!;
  expect(selada.origem).toBe("SELO");

  // download do selado: PDF válido, mais páginas que o original (folha de assinaturas), QR (imagem) em cada página
  const baixar = async (versao: string) => Buffer.from(await (await request.get(`/api/v1/ged/documentos/${termo.id}/arquivo?versao=${versao}`, { headers: auth(tk) })).body());
  const bufSelado = await baixar(selada.id);
  const bufOrig = await baixar(original.id);
  expect(bufSelado.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bufSelado.toString("latin1")).toContain("/ByteRange"); // assinatura PAdES presente
  const pdfSel = await PDFDocument.load(bufSelado);
  const pdfOri = await PDFDocument.load(bufOrig);
  expect(pdfSel.getPageCount()).toBeGreaterThan(pdfOri.getPageCount());
  const hashesQr = new Set<string>();
  for (const [i, pg] of pdfSel.getPages().entries()) {
    const xo = pg.node.Resources()?.lookup(PDFName.of("XObject"));
    const imgs = xo ? [...(xo as unknown as { entries(): [unknown, unknown][] }).entries()].map(([, ref]) => pdfSel.context.lookup(ref as never)).filter((o) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") : [];
    expect(imgs.length, `página ${i + 1} sem imagem do QR`).toBeGreaterThan(0);
    for (const im of imgs as PDFRawStream[]) hashesQr.add(Buffer.from(im.contents).toString("base64").slice(0, 200));
  }
  if (temPdftotext()) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "t19-"));
    try {
      writeFileSync(path.join(dir, "s.pdf"), bufSelado);
      for (let p = 1; p <= pdfSel.getPageCount(); p++) {
        const txt = execFileSync("pdftotext", ["-f", String(p), "-l", String(p), path.join(dir, "s.pdf"), "-"], { encoding: "utf8" });
        expect(txt, `código verificador no rodapé da página ${p}`).toContain(termo.codigo_verificador!);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // verificação pública, SEM login (contexto novo, sem cookies)
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL as string });
  const pub = await ctx.newPage();
  await pub.goto(`/verificar/${termo.codigo_verificador}`);
  await expect(pub.getByTestId("status-verificacao")).toHaveText("AUTÊNTICO");
  await expect(pub.getByTestId("codigo-verificador")).toHaveText(termo.codigo_verificador!);
  await expect(pub.getByTestId("signatario-publico")).toHaveCount(2);
  const nomes = await pub.getByTestId("signatario-publico").allTextContents();
  expect(nomes.join(" ")).not.toContain("Carlos Eduardo Tavares"); // nome abreviado
  await expect(pub.getByTestId("hash-final")).toHaveText(termo.sha256_final!);
  await expect(pub.getByText(/sem login|login/i)).toHaveCount(0);
  await aguardarHidratacao(pub).catch(() => undefined);

  const conferir = async (nome: string, buffer: Buffer) => {
    await pub.locator("#arquivo-conferir").setInputFiles({ name: nome, mimeType: "application/pdf", buffer });
    return pub.getByTestId("resultado-conferencia");
  };
  await expect(await conferir("selado.pdf", bufSelado)).toHaveAttribute("data-resultado", "SELADO", { timeout: 20_000 });
  await expect(await conferir("original.pdf", bufOrig)).toHaveAttribute("data-resultado", "ORIGINAL", { timeout: 20_000 });
  const adulterado = Buffer.from(bufSelado);
  adulterado[adulterado.length - 40] ^= 0x01; // 1 byte
  await expect(await conferir("adulterado.pdf", adulterado)).toHaveAttribute("data-resultado", "DIFERENTE", { timeout: 20_000 });
  await expect(pub.getByTestId("resultado-conferencia")).toContainText("FALHA");

  // código inexistente: resposta genérica
  await pub.goto("/verificar/ZZZZ-ZZZZ-ZZZZ");
  await expect(pub.getByTestId("status-verificacao")).toHaveText("NÃO ENCONTRADO");
  await ctx.close();
  expect(hashesQr.size).toBeGreaterThan(0);
});
