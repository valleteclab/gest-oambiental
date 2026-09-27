import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PROJETO_DESKTOP, apenasNoProjeto, estadoDeT1, login, logout } from "./helpers";

// T5 – Autenticidade [PoC-5] (SPEC 13). Usa a LO emitida em T1 (test-results/poc-estado.json).
// /validar/{codigo} (destino do QR Code) mostra VÁLIDO com os dados; o PDF baixado confere com o hash
// registrado; após o cancelamento pelo gestor, a mesma página mostra CANCELADO.
// Obs.: não há decodificador de QR no projeto; o vínculo PDF ↔ página é verificado pelo SHA-256 do arquivo
// (conferido na própria página) e pelo número da licença no título do PDF. Altera dados: só no desktop.

const MOTIVO = "Cancelamento para teste de autenticidade (T5) – emitido com erro material no endereço.";

/** Título do PDF (Info /Title), em UTF-16BE hexadecimal ou literal. */
function tituloPdf(pdf: Buffer): string {
  const txt = pdf.toString("latin1");
  const hex = txt.match(/\/Title\s*<FEFF([0-9A-Fa-f]+)>/);
  if (hex) return Buffer.from(hex[1], "hex").swap16().toString("utf16le");
  return txt.match(/\/Title\s*\(([^)]*)\)/)?.[1] ?? "";
}

test("T5 – validação pública da LO de T1: VÁLIDO, PDF íntegro e, após cancelamento, CANCELADO", async ({ page }, testInfo) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  const codigo = estadoDeT1(testInfo, "lo_codigo");
  const numeroLo = estadoDeT1(testInfo, "lo_numero");
  const docId = estadoDeT1(testInfo, "lo_documento_id");
  const numeroProcesso = estadoDeT1(testInfo, "processo_numero");
  const urlValidacao = `/validar/${codigo}`;

  // ── Cidadão (sem login) abre a URL do QR Code ──
  const r = await page.goto(urlValidacao);
  expect(r?.status()).toBe(200);
  await expect(page.getByTestId("status-documento")).toHaveText("VÁLIDO");
  await expect(page.getByText("Documento autêntico e válido.")).toBeVisible();
  const dados = page.getByRole("region", { name: "Dados do documento" });
  await expect(dados).toContainText(numeroLo);
  await expect(dados).toContainText("Licença de Operação");
  await expect(dados).toContainText("Laticínio Boa Vista Ltda");
  await expect(dados).toContainText("Laticínio Boa Vista – Lagoa do Orvalho");
  await expect(dados.getByRole("link", { name: numeroProcesso })).toBeVisible();
  await expect(dados).toContainText(codigo);
  const hash = (await page.getByTestId("hash-documento").innerText()).trim();
  expect(hash).toMatch(/^[0-9a-f]{64}$/);

  // PDF original: começa com %PDF, traz o número da licença e confere com o hash exibido
  const resp = await page.request.get(`/api/v1/documentos/${docId}/pdf`);
  expect(resp.status()).toBe(200);
  const pdf = await resp.body();
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(tituloPdf(pdf)).toContain(numeroLo);
  expect(createHash("sha256").update(pdf).digest("hex")).toBe(hash);
  await page.getByLabel("Conferir um arquivo PDF que você recebeu").setInputFiles({ name: "licenca.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByTestId("resultado-hash")).toContainText("Arquivo íntegro");

  // ── Gestor cancela o documento ──
  await login(page, "gestorLor");
  await page.goto(`/documentos/${docId}`);
  await page.getByLabel("Motivo do cancelamento (obrigatório)").fill(MOTIVO);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("btn-cancelar-documento").click();
  // A página recarrega sem o formulário e com o aviso do cancelamento
  await expect(page.getByRole("status").filter({ hasText: "Documento cancelado em" })).toContainText(MOTIVO, { timeout: 30_000 });
  await expect(page.getByTestId("btn-cancelar-documento")).toHaveCount(0);
  await logout(page);

  // ── A mesma página pública agora mostra CANCELADO ──
  await page.goto(urlValidacao);
  await expect(page.getByTestId("status-documento")).toHaveText("CANCELADO");
  await expect(page.getByTestId("motivo-cancelamento")).toContainText(MOTIVO);
  await expect(page.getByRole("region", { name: "Dados do documento" })).toContainText(numeroLo);
});
