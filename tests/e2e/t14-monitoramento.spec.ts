import { test, expect, type Page } from "@playwright/test";
import { DADOS, PROJETO_DESKTOP, apenasNoProjeto, entrarComo, login } from "./helpers";

// T14 – Monitoramento por satélite (docs/monitoramento.md) com os alertas FICTÍCIOS da demonstração
// (prisma/seed/monitoramento-demo.ts: DEMO-LOR-01…05 no município principal). Técnico: lista, KPIs, mapa, ficha com CAR,
// "Abrir fiscalização", "Descartar" e "Marcar autorizado"; SEMA: somente leitura; técnico de outro município: 403.
// Altera dados: roda só no projeto desktop. Reexecutável (reabre a análise antes de descartar/autorizar de novo).

test.skip(DADOS.dataset !== "demo", "Alertas fictícios de monitoramento só existem no dataset demo.");

const P = DADOS.principal;

async function abrirFicha(page: Page, idExterno: string) {
  await page.goto("/monitoramento?de=");
  const linha = page.locator(`tr[data-testid="alerta-linha"][data-id-externo="${idExterno}"]`);
  await expect(linha).toBeVisible();
  await linha.getByRole("link", { name: "Ficha" }).click();
  await expect(page.getByTestId("ficha-alerta")).toHaveAttribute("data-id-externo", idExterno);
  await page.waitForLoadState("networkidle");
  return page.url();
}

/** Deixa o alerta em NOVO/EM_ANÁLISE (se já foi descartado/autorizado numa execução anterior). */
async function reabrirSeFinalizado(page: Page) {
  const status = (await page.getByTestId("status-alerta").innerText()).trim();
  if (["Descartado", "Autorizado", "Irregular"].includes(status)) {
    await page.getByTestId("status-em-analise").click();
    await expect(page.getByTestId("status-alerta")).toHaveText("Em análise");
  }
}

test.describe("T14 – Monitoramento por satélite", () => {
  test.beforeEach(() => apenasNoProjeto(PROJETO_DESKTOP));

  test(`técnico de ${P.nome}: menu, painel, KPIs, mapa e lista só do seu município`, async ({ page }) => {
    await login(page, "tecnicoPrincipal");
    await expect(page.getByTestId("kpi-desmatamento-novos")).toBeVisible();
    await page.getByRole("link", { name: "Monitoramento", exact: true }).first().click();
    await expect(page).toHaveURL(/\/monitoramento/);
    await expect(page.getByRole("heading", { name: "Monitoramento por satélite" })).toBeVisible();
    const total = Number((await page.getByTestId("kpi-alertas").innerText()).replace(/\D/g, ""));
    expect(total).toBeGreaterThanOrEqual(5);
    await expect(page.getByTestId("kpi-area")).toContainText("ha");
    await expect(page.getByTestId("kpi-com-car")).toContainText("%");
    await expect(page.getByTestId("mapa-monitoramento")).toHaveAttribute("data-feicoes", /[1-9]/);
    await expect(page.locator(".leaflet-container path.leaflet-interactive").first()).toBeVisible();
    const ids = await page.locator('tr[data-testid="alerta-linha"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-id-externo")));
    for (const i of [1, 2, 3, 4, 5]) expect(ids).toContain(`DEMO-${P.sigla}-0${i}`);
    expect(ids.every((x) => x?.startsWith(`DEMO-${P.sigla}-`))).toBeTruthy();
    // Filtro por situação
    await page.getByTestId("filtro-status").selectOption("DESCARTADO");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.locator('tr[data-testid="alerta-linha"]').first()).toBeVisible();
    for (const s of await page.locator('tr[data-testid="alerta-linha"] td:nth-child(7)').allInnerTexts()) expect(s.trim()).toBe("Descartado");
    // Município com código IBGE fictício: "Sincronizar agora" explica que não há dados do INPE
    await page.getByTestId("sincronizar-agora").click();
    await expect(page.getByRole("alert").filter({ hasText: "código IBGE fictício" })).toBeVisible();
  });

  test("ficha: CAR intersectado, comparação antes/depois e abrir fiscalização vinculada", async ({ page }) => {
    await login(page, "tecnicoPrincipal");
    const ficha = await abrirFicha(page, `DEMO-${P.sigla}-01`);
    await expect(page.getByTestId("sugestao")).toContainText("Possível irregularidade");
    await expect(page.getByTestId("tabela-car")).toContainText(`BA-9900101-7C1D2E3F`);
    await page.getByTestId("abrir-comparar").click();
    await expect(page.getByTestId("comparar-imagens")).toBeVisible();
    if (await page.getByTestId("abrir-fiscalizacao").isVisible()) {
      await page.getByTestId("abrir-fiscalizacao").click();
      await expect(page).toHaveURL(/\/fiscalizacao\/[0-9a-f-]{36}$/);
      await expect(page.getByText(/alerta de desmatamento por satélite/i)).toBeVisible();
      await page.goto(ficha);
    }
    await expect(page.getByTestId("link-fiscalizacao")).toBeVisible();
    await expect(page.getByTestId("abrir-fiscalizacao")).toHaveCount(0);
    await expect(page.getByTestId("status-alerta")).not.toHaveText("Novo");
  });

  test("descartar com motivo e marcar autorizado vinculando a licença sugerida", async ({ page }) => {
    await login(page, "tecnicoPrincipal");
    await abrirFicha(page, `DEMO-${P.sigla}-03`);
    await reabrirSeFinalizado(page);
    await page.getByTestId("modo-descartar").click();
    await page.getByTestId("confirmar-status").click(); // motivo obrigatório (validação do navegador)
    await expect(page.getByTestId("status-alerta")).not.toHaveText("Descartado");
    const motivo = `Falso positivo: sombra de nuvem (teste E2E ${Date.now()}).`;
    await page.getByLabel("Motivo do descarte *").fill(motivo);
    await page.getByTestId("confirmar-status").click();
    await expect(page.getByTestId("status-alerta")).toHaveText("Descartado");
    await expect(page.getByTestId("observacao-alerta")).toHaveText(motivo);

    await abrirFicha(page, `DEMO-${P.sigla}-02`);
    await expect(page.getByTestId("sugestao")).toContainText("Autorizado");
    await reabrirSeFinalizado(page);
    await page.getByTestId("modo-autorizado").click();
    const sel = page.getByLabel("Licença/ASV que autoriza a supressão *");
    await expect(sel).not.toHaveValue(""); // pré-selecionada pelo cruzamento
    await page.getByTestId("confirmar-status").click();
    await expect(page.getByTestId("status-alerta")).toHaveText("Autorizado");
    await expect(page.getByTestId("documento-vinculado")).toHaveText(/^LI /);
  });

  test("SEMA/INEMA: somente leitura; técnico de outro município: 403", async ({ page }) => {
    await login(page, "tecnicoPrincipal");
    const ficha = await abrirFicha(page, `DEMO-${P.sigla}-04`);
    await entrarComo(page, "sema");
    await page.goto(ficha);
    await expect(page.getByTestId("ficha-alerta")).toBeVisible();
    await expect(page.getByTestId("somente-leitura")).toBeVisible();
    await expect(page.getByTestId("acoes-alerta")).toHaveCount(0);
    await page.goto("/monitoramento");
    await expect(page.getByTestId("sincronizar-agora")).toHaveCount(0);
    await entrarComo(page, "tecnicoOutro");
    const r = await page.goto(ficha);
    expect(r?.status()).toBe(403);
  });
});
