import { test, expect } from "@playwright/test";
import { ANO, DADOS, FOTOS_VISTORIA, PROJETO_MOBILE, apenasNoProjeto, login } from "./helpers";

// T4 – Fiscalização [PoC-4] (SPEC 13). Fiscal no CELULAR (projeto mobile-pixel7, geolocalização simulada):
// vistoria a partir de denúncia com "Capturar localização" + 2 fotos → aparece no mapa no ponto capturado →
// Auto de Infração e Notificação com PDFs numerados. Altera dados: roda só no projeto mobile.

// Ponto simulado pelo GPS do aparelho (zona urbana do município principal do dataset)
const GPS = DADOS.cenarios.t4Gps;
const P = DADOS.principal.sigla;

test.use({ geolocation: GPS, permissions: ["geolocation"] });

/** CPF válido a partir de 9 dígitos. */
function cpf(base9: string) {
  const d = base9.split("").map(Number);
  for (const n of [9, 10]) {
    const s = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join("");
}
const AUTUADO = { cpf: cpf("486215937"), nome: "Raimundo Nonato Ferreira" };

test("T4 – fiscal no celular registra vistoria de denúncia com GPS e 2 fotos, gera Auto de Infração e Notificação", async ({ page, isMobile }) => {
  apenasNoProjeto(PROJETO_MOBILE, "Fiscalização em campo – executado apenas no projeto mobile.");
  test.setTimeout(180_000);
  expect(isMobile).toBe(true);

  await login(page, "fiscalPrincipal");

  // ── Denúncia do município principal ainda não concluída ──
  await page.goto("/fiscalizacao/denuncias");
  const denuncia = page.getByTestId("lista-denuncias").locator("li").filter({ hasNotText: /Concluída|Arquivada|Improcedente/ }).first();
  await expect(denuncia).toBeVisible();
  const protocolo = (await denuncia.locator(".font-medium").first().innerText()).trim();
  expect(protocolo).toMatch(new RegExp(`^DEN-${P}-\\d{3}/${ANO}$`));
  await denuncia.getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Denúncia ${protocolo}`);
  await page.getByTestId("registrar-vistoria").click();
  await expect(page).toHaveURL(/\/fiscalizacao\/nova\?denuncia=/);

  // ── Vistoria: GPS + 2 fotos ──
  const form = page.getByTestId("form-vistoria");
  await expect(form.getByText(`Denúncia ${protocolo}`)).toBeVisible();
  // (repete o toque se a página ainda estiver hidratando)
  await expect(async () => {
    await page.getByTestId("capturar-localizacao").click();
    await expect(page.getByTestId("posicao")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("posicao")).toContainText(`${GPS.latitude.toFixed(6)}, ${GPS.longitude.toFixed(6)}`);
  await expect(page.getByTestId("precisao")).toContainText("±8 m");

  await page.getByTestId("input-fotos").setInputFiles(FOTOS_VISTORIA);
  await expect(page.getByTestId("miniaturas").locator("img")).toHaveCount(2, { timeout: 30_000 });

  await form.locator("label", { hasText: "Irregular" }).click();
  await page.getByLabel("Relato da vistoria *").fill("Constatado lançamento de efluente sem tratamento em canal de drenagem pluvial, com odor característico e coloração escura. Responsável presente no local.");
  await expect(page.getByTestId("salvar-vistoria")).toHaveText("Salvar vistoria (2 fotos)");
  await page.getByTestId("salvar-vistoria").click();

  await page.waitForURL(/\/fiscalizacao\/[0-9a-f-]{36}\?criada=1/, { timeout: 60_000 });
  const fiscalizacaoId = new URL(page.url()).pathname.split("/")[2];
  await expect(page.getByText(`Vistoria registrada com sucesso – denúncia ${protocolo} em apuração.`)).toBeVisible();
  await expect(page.getByTestId("ficha-coordenadas")).toContainText(`${GPS.latitude.toFixed(6)}, ${GPS.longitude.toFixed(6)}`);
  await expect(page.getByTestId("galeria").locator("img")).toHaveCount(2);
  // Fotos servidas
  for (const src of await page.getByTestId("galeria").locator("img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute("src")!))) {
    const r = await page.request.get(src);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/^image\//);
  }
  // Mapa da ficha centrado no ponto capturado: a ponta do marcador fica no centro do mapa
  const mapaFicha = page.locator(".leaflet-container");
  await expect(mapaFicha.locator(".leaflet-marker-icon")).toHaveCount(1);
  await expect(mapaFicha.locator(".leaflet-marker-icon")).toBeVisible();
  const [caixaMapa, caixaPino] = [await mapaFicha.boundingBox(), await mapaFicha.locator(".leaflet-marker-icon").boundingBox()];
  expect(Math.abs(caixaPino!.x + caixaPino!.width / 2 - (caixaMapa!.x + caixaMapa!.width / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(caixaPino!.y + caixaPino!.height - (caixaMapa!.y + caixaMapa!.height / 2))).toBeLessThanOrEqual(2);
  // Coordenadas gravadas = ponto capturado
  const api = await page.request.get(`/api/v1/fiscalizacoes/${fiscalizacaoId}`);
  expect(api.status()).toBe(200);
  const f = await api.json();
  expect(Number(f.latitude)).toBeCloseTo(GPS.latitude, 6);
  expect(Number(f.longitude)).toBeCloseTo(GPS.longitude, 6);
  expect(f.denuncia?.protocolo).toBe(protocolo);

  // ── Aparece no mapa da fiscalização, no ponto capturado ──
  await page.goto("/fiscalizacao/mapa?tipo=vistorias");
  const mapa = page.getByTestId("mapa-fiscalizacao");
  await expect(mapa.locator(".leaflet-container")).toBeVisible();
  const marcadores = mapa.locator('.leaflet-marker-icon[title^="Vistoria"]');
  await expect(marcadores.first()).toBeAttached();
  const n = await marcadores.count();
  let achou = false;
  for (let i = 0; i < n && !achou; i++) {
    await marcadores.nth(i).dispatchEvent("click");
    // o popup anterior pode ficar no DOM por um instante enquanto o Leaflet o fecha
    await expect(mapa.locator(".leaflet-popup")).toHaveCount(1);
    const link = mapa.locator(".leaflet-popup").getByRole("link", { name: "Abrir ficha" });
    await expect(link).toBeVisible();
    achou = (await link.getAttribute("href")) === `/fiscalizacao/${fiscalizacaoId}`;
  }
  expect(achou, "marcador da nova vistoria no mapa").toBe(true);

  // ── Auto de Infração ──
  await page.goto(`/fiscalizacao/${fiscalizacaoId}`);
  await page.getByTestId("gerar-auto").click();
  const formAuto = page.getByTestId("form-auto");
  await expect(formAuto).toBeVisible();
  await formAuto.getByTestId("nova-pessoa").click();
  await formAuto.getByTestId("np-doc").fill(AUTUADO.cpf);
  await formAuto.getByTestId("np-nome").fill(AUTUADO.nome);
  await formAuto.getByLabel("Enquadramento legal *").fill("Art. 54 da Lei Federal nº 9.605/1998; Art. 62, V do Decreto nº 6.514/2008.");
  await expect(formAuto.getByLabel("Descrição da infração *")).not.toHaveValue("");
  await formAuto.getByLabel("Penalidade *").selectOption("MULTA");
  await formAuto.getByLabel(/Valor da multa/).fill("5.000,00");
  await page.getByTestId("lavrar-auto").click();
  await page.waitForURL(/\/fiscalizacao\/[0-9a-f-]{36}\?auto=/, { timeout: 60_000 });
  const numAuto = decodeURIComponent(new URL(page.url()).searchParams.get("auto")!);
  expect(numAuto).toMatch(new RegExp(`${P}.*\\d+/${ANO}$`));
  await expect(page.getByText(`Auto de infração ${numAuto} lavrado e PDF emitido.`)).toBeVisible();
  const itemAuto = page.getByTestId("lista-autos").locator("li", { hasText: numAuto });
  await expect(itemAuto).toContainText(AUTUADO.nome);
  const pdfAuto = await page.request.get((await itemAuto.getByTestId("link-pdf").getAttribute("href"))!);
  expect(pdfAuto.status()).toBe(200);
  expect(pdfAuto.headers()["content-type"]).toContain("application/pdf");
  expect((await pdfAuto.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // ── Notificação ──
  await page.getByTestId("gerar-notificacao").click();
  const formNot = page.getByTestId("form-notificacao");
  await expect(formNot).toBeVisible();
  await formNot.getByTestId("nova-pessoa").click();
  await formNot.getByTestId("np-doc").fill(AUTUADO.cpf);
  await formNot.getByTestId("np-nome").fill(AUTUADO.nome);
  await formNot.getByLabel("Exigência *").fill("Cessar imediatamente o lançamento de efluentes e apresentar projeto de sistema de tratamento assinado por profissional habilitado.");
  await formNot.getByLabel("Prazo para atendimento (dias) *").fill("30");
  await expect(page.getByTestId("prazo-ate")).toHaveText(/\d{2}\/\d{2}\/\d{4}/);
  await page.getByTestId("emitir-notificacao").click();
  await page.waitForURL(/\/fiscalizacao\/[0-9a-f-]{36}\?notificacao=/, { timeout: 60_000 });
  const numNot = decodeURIComponent(new URL(page.url()).searchParams.get("notificacao")!);
  expect(numNot).toMatch(new RegExp(`${P}.*\\d+/${ANO}$`));
  await expect(page.getByText(`Notificação ${numNot} emitida com PDF.`)).toBeVisible();
  const itemNot = page.getByTestId("lista-notificacoes").locator("li", { hasText: numNot });
  await expect(itemNot).toContainText(AUTUADO.nome);
  const pdfNot = await page.request.get((await itemNot.getByTestId("link-pdf").getAttribute("href"))!);
  expect(pdfNot.status()).toBe(200);
  expect((await pdfNot.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect(numNot).not.toBe(numAuto);
});
