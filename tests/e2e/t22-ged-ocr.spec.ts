import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { USUARIOS_GED, auth, carregarIdsGed, criarDocumentoApi, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, sufixoUnico, temPdftotext, tokenCache } from "./ged-helpers";

// T22 – GED fase 2: OCR no servidor (ocrmypdf) de PDF digitalizado (só imagem) → nova versão origem=OCR, pesquisável.
// Dados: seed `E2E_GED_IDS=1 npm run seed:ged-demo`. Pré-requisitos no ambiente do SERVIDOR (CI/container): ocrmypdf + tesseract-ocr-por
// + poppler-utils (ou GED_OCR_BIN). O app web processa o OCR em segundo plano quando não há worker (build de produção local).
// Sem ocrmypdf neste ambiente o spec se pula (a degradação "OCR indisponível" é coberta nos testes unitários).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const ids = IDS!;
const A = USUARIOS_GED.A;
test.describe.configure({ timeout: 240_000 });

function binarioOcrDisponivel(): boolean {
  try {
    execFileSync(process.env.GED_OCR_BIN || "ocrmypdf", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const SEM_OCR = "ocrmypdf ausente neste ambiente (apt install ocrmypdf tesseract-ocr tesseract-ocr-por ghostscript qpdf unpaper) – OCR real não verificado.";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** PDF "escaneado": UMA imagem (PNG renderizado pelo Chromium) com o texto, sem nenhuma camada de texto. */
async function gerarPdfEscaneado(browser: import("@playwright/test").Browser, linhas: string[]): Promise<Buffer> {
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 700 }, deviceScaleFactor: 1 });
  try {
    const p = await ctx.newPage();
    await p.setContent(`<html><body style="margin:0;background:#fff"><div style="padding:40px;font:bold 54px 'DejaVu Sans',Arial,sans-serif;color:#000;line-height:1.5">${linhas.map((l) => `<div>${l}</div>`).join("")}</div></body></html>`);
    const png = await p.screenshot({ type: "png" });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    const pag = doc.addPage([595, 842]);
    const w = 515;
    pag.drawImage(img, { x: 40, y: 842 - 40 - (w * img.height) / img.width, width: w, height: (w * img.height) / img.width });
    return Buffer.from(await doc.save());
  } finally {
    await ctx.close();
  }
}

type VersaoApi = { id: string; n: number; origem: string; sha256: string; texto_status: string; ocr_status: string | null };
async function detalhe(request: APIRequestContext, token: string, id: string) {
  const r = await request.get(`/api/v1/ged/documentos/${id}`, { headers: auth(token) });
  expect(r.status()).toBe(200);
  return (await r.json()) as { status: string; versao_atual_id: string; versoes: VersaoApi[] };
}

test("T22a – digitalizado sem texto: OCR cria versão pesquisável, preserva o original, não cancela assinatura aberta; outro cliente não vê", async ({ page, request, browser }) => {
  test.skip(!binarioOcrDisponivel(), SEM_OCR);
  test.skip(!temPdftotext(), "pdftotext ausente: a extração (e a decisão de OCR) depende dele.");
  const suf = sufixoUnico();
  const titulo = `Ofício digitalizado T22 ${suf}`;
  const palavra = "paralelepípedo"; // palavra comum do português; a unicidade vem do título
  const busca = "paralelepipedo"; // a busca ignora acentos
  const original = await gerarPdfEscaneado(browser, ["Prefeitura Municipal", `Ofício sobre ${palavra}`, "Calçamento da rua principal"]);
  const tk = await tokenCache(request, A.servidor1);
  const doc = await criarDocumentoApi(request, tk, { titulo, pdf: original });

  // Assinatura aberta logo após o upload (o OCR ainda roda): a versão OCR NÃO pode cancelá-la
  const sol = await request.post("/api/v1/ged/assinaturas", { headers: auth(tk), data: { documento_id: doc.id, signatarios: [ids.A.usuarios[A.vereador]], modo: "SEQUENCIAL", mensagem: "Assinar após OCR" } });
  expect(sol.status(), await sol.text()).toBe(201);

  // Espera: v1 = UPLOAD com ocr_status CONCLUIDO e v2 = OCR
  let d = await detalhe(request, tk, doc.id);
  await expect
    .poll(async () => {
      d = await detalhe(request, tk, doc.id);
      return d.versoes.find((v) => v.n === 1)?.ocr_status ?? d.versoes.find((v) => v.n === 1)?.texto_status ?? "?";
    }, { timeout: 150_000, intervals: [2000, 4000] })
    .toBe("CONCLUIDO");
  expect(d.versoes.map((v) => v.origem).sort()).toEqual(["OCR", "UPLOAD"]);
  const v1 = d.versoes.find((v) => v.n === 1)!;
  const v2 = d.versoes.find((v) => v.n === 2)!;
  expect(v2.origem).toBe("OCR");
  expect(v2.texto_status).toBe("EXTRAIDO");
  expect(d.versao_atual_id).toBe(v2.id);
  expect(v2.sha256).not.toBe(v1.sha256);
  expect(d.status, "o OCR não cancela a solicitação de assinatura aberta").toBe("EM_ASSINATURA");

  // O scan original permanece intacto (mesmo hash do que foi enviado)
  expect(v1.sha256).toBe(sha(original));
  const baixado = await request.get(`/api/v1/ged/documentos/${doc.id}/arquivo?versao=${v1.id}`, { headers: auth(tk) });
  expect(baixado.status()).toBe(200);
  expect(sha(Buffer.from(await baixado.body()))).toBe(v1.sha256);

  // Busca pelo conteúdo do scan (API e UI)
  const b = await request.get(`/api/v1/ged/busca?q=${busca}`, { headers: auth(tk) });
  expect(b.status()).toBe(200);
  expect(JSON.stringify(itensDe(await b.json()))).toContain(doc.id);
  await loginGed(page, A.servidor1);
  await page.goto(`/ged/documentos?q=${busca}`);
  await expect(page.getByTestId("documento-item").filter({ hasText: titulo })).toHaveCount(1);

  // Estado visível na ficha do documento
  await irPara(page, `/ged/documentos/${doc.id}`);
  await expect(page.getByTestId("ocr-status")).toHaveAttribute("data-status", "CONCLUIDO");
  await expect(page.getByTestId("versoes")).toContainText("Reconhecimento de texto (OCR)");
  await expect(page.getByRole("button", { name: "Reprocessar OCR" })).toHaveCount(0); // já concluído (e servidor não é admin/gestor)

  // Outro cliente (AAC): nada
  const outro = await request.get(`/api/v1/ged/busca?q=${busca}`, { headers: auth(await tokenCache(request, USUARIOS_GED.B.admin)) });
  expect(outro.status()).toBe(200);
  expect(JSON.stringify(itensDe(await outro.json()))).not.toContain(doc.id);
  const direto = await request.get(`/api/v1/ged/documentos/${doc.id}`, { headers: auth(await tokenCache(request, USUARIOS_GED.B.admin)) });
  expect(direto.status()).toBe(404);
});

test("T22b – configurações: cota mensal de OCR visível ao administrador e salva", async ({ page }) => {
  await loginGed(page, A.admin);
  await irPara(page, "/ged/admin/configuracoes");
  const campo = page.getByLabel("Cota mensal de OCR (páginas)");
  await expect(campo).toBeVisible();
  await expect(page.getByTestId("ocr-uso")).toContainText("Uso neste mês");
  const antes = await campo.inputValue();
  await campo.fill("7777");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas.").first()).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByLabel("Cota mensal de OCR (páginas)")).toHaveValue("7777");
  // restaura o valor anterior
  await page.getByLabel("Cota mensal de OCR (páginas)").fill(antes);
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas.").first()).toBeVisible({ timeout: 20_000 });
});
