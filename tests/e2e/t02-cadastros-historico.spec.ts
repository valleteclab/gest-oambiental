import { test, expect } from "@playwright/test";
import { ANO, DADOS, login, reProcesso } from "./helpers";

// T2 – Cadastros e histórico [PoC-2] (SPEC 13). Somente leitura: roda nos dois projetos.
// Ficha do "Posto Estrela" do município t2 do dataset (demo: Serra Serena; PoC: Ruy Barbosa): requerente, RT com registro no conselho, coordenadas no mapa,
// 3 processos (LP, LI, LO) e as licenças vinculadas.

const { empreendimento: EMPREENDIMENTO, busca: BUSCA, requerente: REQUERENTE, bbox: BBOX } = DADOS.cenarios.t2;
const S = DADOS.t2.sigla;

test("T2 – ficha do empreendimento com requerente, RT, mapa, processos LP/LI/LO e licenças", async ({ page }) => {
  await login(page, "tecnicoT2");
  await page.goto("/empreendimentos");
  await page.getByLabel("Nome, requerente ou CAR").fill(BUSCA);
  await page.getByLabel("Nome, requerente ou CAR").press("Enter");
  await page.getByRole("link", { name: EMPREENDIMENTO, exact: true }).click();
  await expect(page).toHaveURL(/\/empreendimentos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(EMPREENDIMENTO);

  // Requerente (com CNPJ mascarado)
  const req = page.getByTestId("ficha-requerente");
  await expect(req).toContainText(REQUERENTE);
  await expect(req).toContainText(/\d{2}\.\d{3}\.\d{3}\/\*{4}-\*{2}/);

  // RT com registro no conselho
  const rt = page.getByTestId("ficha-rt");
  await expect(rt.getByRole("link")).not.toHaveText("");
  await expect(rt).toContainText(/(CREA|CRBio|CRQ|CAU|CFT) nº [\w./-]+\/BA/);

  // Coordenadas e ponto no mapa
  const coords = (await page.getByTestId("ficha-coordenadas").innerText()).trim();
  const [lat, lng] = coords.split(",").map((x) => Number(x.trim()));
  expect(lat).toBeGreaterThan(BBOX.latMin);
  expect(lat).toBeLessThan(BBOX.latMax);
  expect(lng).toBeGreaterThan(BBOX.lngMin);
  expect(lng).toBeLessThan(BBOX.lngMax);
  const mapa = page.locator(".leaflet-container");
  await expect(mapa).toBeVisible();
  await expect(mapa.locator(".leaflet-marker-icon")).toHaveCount(1);

  // 3 processos: LP, LI e LO
  const processos = page.getByTestId("ficha-processos").locator("tbody tr");
  await expect(processos).toHaveCount(3);
  const siglas = (await processos.locator("td:nth-child(2)").allInnerTexts()).map((s) => s.trim()).sort();
  expect(siglas).toEqual(["LI", "LO", "LP"]);
  for (const numero of await processos.locator("td:first-child").allInnerTexts()) expect(numero.trim()).toMatch(reProcesso(S));

  // Licenças vinculadas (uma por processo) com código de autenticidade
  const licencas = page.getByTestId("ficha-licencas").locator("tbody tr");
  await expect(licencas).toHaveCount(3);
  const tipos = (await licencas.locator("td:nth-child(2)").allInnerTexts()).map((s) => s.trim()).sort();
  expect(tipos).toEqual(["Licença (LI)", "Licença (LO)", "Licença (LP)"]);
  for (const numero of await licencas.locator("td:first-child").allInnerTexts()) expect(numero.trim()).toMatch(new RegExp(`^L[PIO]-${S}-\\d{3}/${ANO}$`));
  await expect(licencas.locator('a[href^="/validar/"]')).toHaveCount(3);
});
