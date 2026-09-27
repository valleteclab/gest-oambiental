import { test, expect } from "@playwright/test";
import { estadoDeT1 } from "./helpers";

// T8 – Portal público [PoC-8] (SPEC 13). Sem login: consulta pelo nº do processo de T1 → linha do tempo
// pública e CPF/CNPJ mascarado, sem despachos internos nem dados pessoais. Somente leitura: dois projetos.

// Textos de despachos/pendência gravados em T1 que NÃO podem aparecer no portal
const INTERNOS = ["Distribuído para análise da LO do laticínio", "Apresentar laudo de análise do efluente", "iniciada a análise técnica", "Deferido conforme parecer técnico", "Técnico(a) de Lagoa do Orvalho", "Gestor(a) de Lagoa do Orvalho"];

test("T8 – consulta pública do processo de T1: linha do tempo pública e documento mascarado", async ({ page }, testInfo) => {
  const numero = estadoDeT1(testInfo, "processo_numero");

  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: /Consultar processo/i }).first().click();
  await expect(page).toHaveURL(/\/consulta/);
  await page.getByLabel("Nº do processo").fill(numero);
  await page.getByRole("button", { name: "Consultar" }).click();

  const res = page.getByTestId("resultado-consulta");
  await expect(res).toBeVisible();
  await expect(res.getByTestId("numero-processo")).toHaveText(numero);
  await expect(res).toContainText("Laticínio Boa Vista – Lagoa do Orvalho");
  await expect(res).toContainText("Licença de Operação");

  // CPF/CNPJ mascarado (CNPJ do Laticínio: 11.222.333/0001-81 no cadastro)
  const doc = (await res.getByTestId("documento-mascarado").innerText()).trim();
  expect(doc).toMatch(/\*/);
  expect(doc).toMatch(/^[\d.*/-]+$/);
  const corpo = await page.locator("body").innerText();
  expect(corpo).not.toContain("11222333000181");
  expect(corpo).not.toContain("11.222.333/0001-81");

  // Linha do tempo pública com as etapas (data + situação), em ordem
  const itens = res.getByTestId("linha-do-tempo").locator("li");
  expect(await itens.count()).toBeGreaterThanOrEqual(7);
  const etapas = (await itens.locator("p.font-medium").allInnerTexts()).map((s) => s.trim());
  const esperadas = ["Requerimento protocolado", "Processo distribuído para análise", "Pendência aberta – ação do requerente necessária", "Pendência respondida pelo requerente", "Documentação aceita – análise técnica iniciada", "Parecer técnico emitido", "Requerimento deferido", "Documento emitido"];
  let pos = -1;
  for (const e of esperadas) {
    const i = etapas.indexOf(e, pos + 1);
    expect(i, `etapa "${e}" em ${JSON.stringify(etapas)}`).toBeGreaterThan(pos);
    pos = i;
  }
  for (const li of await itens.all()) await expect(li.locator("time")).toHaveText(/^\d{2}\/\d{2}\/\d{4}/);
  expect(etapas).not.toContain("Rascunho criado");

  // Sem despachos internos nem nomes de servidores
  for (const t of INTERNOS) expect(corpo, t).not.toContain(t);

  // Documento público (LO) listado com link de validação
  await expect(res.getByRole("link", { name: /^Validar LO-LOR-/ })).toBeVisible();
});

test("T8b – landing lista os órgãos e o portal do órgão leva aos serviços com o município pré-selecionado", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Solicitar demonstração/ }).first()).toHaveAttribute("href", /^mailto:contato@valleteclab\.com\.br/);
  await page.getByTestId("lista-orgaos").getByRole("link", { name: /Lagoa do Orvalho/ }).click();
  await expect(page).toHaveURL(/\/orgao\/LOR$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Secretaria Municipal de Meio Ambiente de Lagoa do Orvalho");
  expect(Number((await page.getByTestId("num-licencas").innerText()).replace(/\D/g, ""))).toBeGreaterThan(0);

  await page.getByRole("main").getByRole("link", { name: /Licenças emitidas/ }).click();
  await expect(page).toHaveURL(/\/licencas\?municipio=LOR/);
  await expect(page.getByTestId("contexto-orgao")).toContainText("Lagoa do Orvalho");
  for (const m of await page.getByTestId("tabela-licencas").locator("tbody td:nth-child(5)").allInnerTexts()) expect(m.trim()).toBe("Lagoa do Orvalho");

  await page.goto("/orgao/LOR");
  await page.getByRole("main").getByRole("link", { name: /^Entrar/ }).click();
  await expect(page).toHaveURL(/\/login\?orgao=LOR/);
  await expect(page.getByLabel("Órgão")).toHaveValue("LOR");

  expect((await page.goto("/orgao/XYZ"))?.status()).toBe(404);
});
