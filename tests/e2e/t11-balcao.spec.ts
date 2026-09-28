import { test, expect, type Page } from "@playwright/test";
import { PDF_EXEMPLO, PROJETO_DESKTOP, apenasNoProjeto, entrarComo, login } from "./helpers";

// T11 – Novo processo (balcão): servidor protocola em nome do requerente que compareceu ao órgão.
// Técnico de Lagoa do Orvalho: (a) requerente existente SEM login (Clínica Sorriso) e (b) PF recém-cadastrada
// (rascunho retomado pela lista "Rascunho" → Continuar). Nº LOR-2026-xxxxxx + recibo PDF; tramitação registra
// o servidor ("Protocolado no balcão por …"). SEMA (somente leitura) e fiscal: sem botão e 403.
// Altera dados: roda só no projeto desktop.

const TECNICO_LOR = "Técnico(a) de Lagoa do Orvalho";
const CLINICA = "Clínica Odontológica Sorriso Ltda";
const EMP_CLINICA = "Clínica Odontológica Sorriso – Lagoa do Orvalho";

/** CPF válido (dígitos verificadores) a partir de 9 dígitos aleatórios. */
function cpfAleatorio(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (d.every((x) => x === d[0])) d[0] = (d[0] + 1) % 10;
  const dv = (base: number[]) => {
    const s = base.reduce((acc, x, i) => acc + x * (base.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join("");
}

/** Navegações por link/form podem ser completas (página ainda não hidratada): espera a rede assentar antes de interagir. */
async function aguardarPagina(page: Page) {
  await page.waitForLoadState("networkidle");
}

async function anexarObrigatorios(page: Page) {
  const itens = page.getByTestId("documentos-exigidos").locator(":scope > li");
  const n = await itens.count();
  expect(n).toBeGreaterThan(0);
  let obrigatorios = 0;
  for (let i = 0; i < n; i++) {
    const item = itens.nth(i);
    if (!(await item.locator("p.text-sm.font-medium").innerText()).includes("*")) continue;
    obrigatorios++;
    await item.locator('input[type="file"]').setInputFiles(PDF_EXEMPLO);
    await expect(item.getByRole("link", { name: "documento-exemplo.pdf" })).toBeVisible({ timeout: 30_000 });
  }
  expect(obrigatorios).toBeGreaterThan(0);
}

/** Revisão → protocolo → tela de conclusão com nº e recibo. Retorna o nº do processo. */
async function protocolar(page: Page, processoId: string) {
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByRole("heading", { name: /6\. Revisão e protocolo/ })).toBeVisible();
  await expect(page.getByText("Faltam documentos obrigatórios")).toHaveCount(0);
  await page.getByRole("button", { name: "Protocolar requerimento" }).click();
  await expect(page.getByTestId("balcao-concluido")).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("rascunho")).toBe(processoId);
  const numero = (await page.getByTestId("numero-protocolado").innerText()).trim();
  expect(numero).toMatch(/^LOR-2026-\d{6}$/);

  const imprimir = page.getByRole("link", { name: "Imprimir recibo" });
  await expect(imprimir).toBeVisible();
  const recibo = await page.request.get((await imprimir.getAttribute("href"))!);
  expect(recibo.status()).toBe(200);
  expect(recibo.headers()["content-type"]).toContain("application/pdf");
  expect((await recibo.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Tramitação: autor = servidor do balcão; requerente permanece o titular
  await page.goto(`/processos/${processoId}?aba=tramitacao`);
  await expect(page.getByTestId("numero-processo")).toHaveText(numero);
  await expect(page.getByTestId("linha-do-tempo").getByText(`Protocolado no balcão por ${TECNICO_LOR}.`)).toBeVisible();
  return numero;
}

test("T11a – técnico protocola no balcão: requerente existente sem login e PF recém-cadastrada", async ({ page }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  test.setTimeout(240_000);
  await login(page, "tecnicoLor");

  // ── (a) Requerente existente, sem login ──
  await page.goto("/processos");
  await page.getByRole("link", { name: "Novo processo (balcão)" }).click();
  await expect(page).toHaveURL(/\/processos\/novo$/);
  await expect(page.getByLabel("Município do processo").locator("option:checked")).toHaveText("Lagoa do Orvalho");
  await page.getByLabel("Nome, razão social ou CPF/CNPJ completo").fill("Sorriso");
  await page.getByRole("button", { name: "Buscar" }).click();
  const resultado = page.getByTestId("resultado-requerentes").locator("li", { hasText: CLINICA });
  await expect(resultado).toContainText("sem login");
  await resultado.getByRole("link", { name: `Selecionar ${CLINICA}` }).click();
  await expect(page.getByTestId("requerente-escolhido")).toBeVisible();
  await aguardarPagina(page);

  await expect(page.getByRole("heading", { name: /1\. Requerente/ })).toBeVisible();
  await expect(page.getByTestId("requerente-escolhido")).toContainText(CLINICA);
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /2\. Empreendimento/ })).toBeVisible();
  const selEmp = page.getByLabel("Empreendimento", { exact: true });
  // Apenas os empreendimentos do requerente escolhido
  await expect(selEmp.locator("option")).toHaveCount(2);
  await selEmp.selectOption({ label: `${EMP_CLINICA} – Lagoa do Orvalho` });
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /3\. Tipologia e porte/ })).toBeVisible();
  await expect(page.getByTestId("porte-calculado")).not.toHaveText("—");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /4\. Tipo de ato/ })).toBeVisible();
  await page.getByRole("radio", { name: /^LO – Licença de Operação/ }).check();
  await page.getByRole("button", { name: "Salvar rascunho e continuar" }).click();
  await expect(page.getByRole("heading", { name: /5\. Documentos/ })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/processos\/novo\?rascunho=[0-9a-f-]{36}&passo=4/);
  const idA = new URL(page.url()).searchParams.get("rascunho")!;
  await anexarObrigatorios(page);
  await protocolar(page, idA);
  await expect(page.getByText(`Requerente: ${CLINICA}`)).toBeVisible();

  // ── (b) Pessoa física nova (cadastro rápido) + rascunho retomado pela lista ──
  const nome = `Joana Balcão ${Date.now().toString().slice(-6)}`;
  await page.goto("/processos/novo");
  await aguardarPagina(page);
  const cadastro = page.getByRole("form", { name: "Cadastrar novo requerente" });
  await cadastro.getByLabel("Pessoa física").check();
  await cadastro.getByLabel("CPF").fill(cpfAleatorio());
  await cadastro.getByLabel("Nome completo").fill(nome);
  await cadastro.getByLabel("Telefone").fill("(75) 99000-1234");
  await cadastro.getByRole("button", { name: "Cadastrar e continuar" }).click();
  await expect(page).toHaveURL(/\/processos\/novo\?municipio=[0-9a-f-]{36}&requerente=[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByTestId("requerente-escolhido")).toContainText(nome);
  await aguardarPagina(page);
  await page.getByLabel("Responsável técnico (opcional)").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /2\. Empreendimento/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Novo empreendimento" })).toBeChecked();
  const empNome = `Lava-Jato ${nome}`;
  await page.getByLabel("Nome do empreendimento *").fill(empNome);
  await page.getByLabel("Latitude").fill("-12.4031");
  await page.getByLabel("Longitude").fill("-40.1162");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /3\. Tipologia e porte/ })).toBeVisible();
  const selTip = page.getByLabel("Tipologia da atividade *");
  await selTip.selectOption(await selTip.locator("option", { hasText: /^E1\.2 / }).getAttribute("value"));
  await page.getByLabel(/^Grandeza/).fill("120");
  await expect(page.getByTestId("porte-calculado")).not.toHaveText("—");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /4\. Tipo de ato/ })).toBeVisible();
  await page.getByRole("radio", { name: /^LO – Licença de Operação/ }).check();
  await page.getByRole("button", { name: "Salvar rascunho e continuar" }).click();
  await expect(page.getByRole("heading", { name: /5\. Documentos/ })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/processos\/novo\?rascunho=[0-9a-f-]{36}&passo=4/);
  const idB = new URL(page.url()).searchParams.get("rascunho")!;

  // Rascunho aparece para o servidor em /processos?status=RASCUNHO com "Continuar"
  await page.goto("/processos?status=RASCUNHO");
  const linha = page.getByTestId("tabela-processos").locator("tr", { hasText: empNome });
  await expect(linha).toContainText(nome);
  await linha.getByRole("link", { name: "Continuar" }).click();
  await expect(page).toHaveURL(new RegExp(`/processos/novo\\?rascunho=${idB}$`));
  await expect(page.getByRole("heading", { name: /5\. Documentos/ })).toBeVisible();
  await aguardarPagina(page);
  await anexarObrigatorios(page);
  await protocolar(page, idB);

  // Escopo: técnico de Campo das Seriemas não retoma/abre o balcão de um processo de Lagoa do Orvalho
  await entrarComo(page, "tecnicoCse");
  const r = await page.goto(`/processos/novo?rascunho=${idA}`);
  expect(r?.status()).toBe(403);
  await expect(page.getByTestId("acesso-negado")).toBeVisible();
});

test("T11b – SEMA (somente leitura) e fiscal não protocolam no balcão (sem botão, 403)", async ({ page }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  for (const perfil of ["sema", "fiscalLor"] as const) {
    await login(page, perfil);
    const lista = await page.goto("/processos");
    expect(lista?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Processos" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Novo processo (balcão)" })).toHaveCount(0);
    const r = await page.goto("/processos/novo");
    expect(r?.status(), perfil).toBe(403);
    await expect(page.getByTestId("acesso-negado")).toBeVisible();
    // Serviço também recusa (não basta esconder o botão)
    const api = await page.request.post("/api/v1/processos", { data: {} });
    expect(api.status(), perfil).toBe(403);
    await page.goto("/sair");
  }
});
