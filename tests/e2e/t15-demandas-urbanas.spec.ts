import { test, expect, type Page } from "@playwright/test";
import { DADOS, PDF_EXEMPLO, PROJETO_DESKTOP, USUARIOS, SENHA_DEMO, apenasNoProjeto, entrarComo, login, reProcesso } from "./helpers";

// T15 – Demandas urbanas (fluxo simplificado): /servicos → requerimento com tipo pré-selecionado e campos do serviço →
// distribuição automática → /demandas (técnico): triagem, vistoria com checklist no celular e decisão pelo próprio técnico →
// autorização emitida com o modelo específico (compensação em mudas / limites em dB(A) e horário).
// Altera dados: roda só no projeto desktop.

const P = DADOS.principal;
const { novoLat: LAT, novoLng: LNG } = DADOS.cenarios.t11;
const sufixo = () => Date.now().toString(36).slice(-5).toUpperCase();
const dataIso = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

async function aguardar(page: Page) {
  await page.waitForLoadState("networkidle");
}

/** Wizard do requerente a partir do tipo pré-selecionado: local novo (imóvel/local), tipologia genérica, campos do serviço. */
async function preencherWizard(page: Page, local: string, campos: (page: Page) => Promise<void>) {
  await expect(page.getByTestId("servico-selecionado")).toBeVisible();
  await expect(page.getByRole("heading", { name: /1\. Empreendimento/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Novo empreendimento" })).toBeChecked();
  await page.getByLabel("Identificação do imóvel/local *").fill(local);
  await expect(page.getByLabel("Município *")).not.toHaveValue("");
  await page.getByLabel("Logradouro").fill(local.split(" – ")[1] ?? "Rua de Teste, 10");
  await page.getByLabel("Latitude").fill(LAT);
  await page.getByLabel("Longitude").fill(LNG);
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /2\. Tipologia e porte/ })).toBeVisible();
  await expect(page.getByLabel("Tipologia da atividade *").locator("option:checked")).toHaveText(/^U1\.\d – /);
  await expect(page.getByTestId("porte-calculado")).toHaveText("Micro");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /3\. Tipo de ato/ })).toBeVisible();
  await campos(page);
  await page.getByRole("button", { name: "Salvar rascunho e continuar" }).click();

  await expect(page.getByRole("heading", { name: /4\. Documentos/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("documentos-exigidos")).toBeVisible({ timeout: 30_000 });
  const itens = page.getByTestId("documentos-exigidos").locator(":scope > li");
  const n = await itens.count();
  let obrigatorios = 0;
  for (let i = 0; i < n; i++) {
    const item = itens.nth(i);
    if (!(await item.locator("p.text-sm.font-medium").innerText()).includes("*")) continue;
    obrigatorios++;
    await item.locator('input[type="file"]').setInputFiles(PDF_EXEMPLO);
    await expect(item.getByRole("link", { name: "documento-exemplo.pdf" })).toBeVisible({ timeout: 30_000 });
  }
  expect(obrigatorios).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByRole("heading", { name: /5\. Revisão e protocolo/ })).toBeVisible();
  await page.getByRole("button", { name: "Protocolar requerimento" }).click();
  await page.waitForURL(/\/meus-processos\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const numero = (await page.getByTestId("numero-processo").innerText()).replace("Processo ", "").trim();
  expect(numero).toMatch(reProcesso(P.sigla));
  return numero;
}

/** Técnico abre a demanda pela fila /demandas (busca pelo nº) e confere a distribuição automática. */
async function abrirDemanda(page: Page, numero: string) {
  await page.goto(`/demandas?municipio=&q=${encodeURIComponent(numero)}`);
  const item = page.getByTestId("demanda-item").filter({ hasText: numero });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Em triagem"); // protocolo → distribuição automática (rodízio)
  await expect(item).not.toContainText("sem técnico");
  await item.getByRole("link", { name: "Atender" }).click();
  await expect(page.getByTestId("numero-processo")).toHaveText(numero);
  await aguardar(page);
}

async function aceitar(page: Page) {
  await page.getByRole("button", { name: "Aceitar e iniciar análise" }).click();
  await expect(page.getByTestId("status-processo")).toContainText("Em análise", { timeout: 30_000 });
  await aguardar(page);
}

test("T15 – APC: requerente pede pelo /servicos, técnico faz a vistoria no checklist, defere e a autorização sai com compensação", async ({ page }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  test.setTimeout(240_000);
  const local = `Residência E2E ${sufixo()} – Rua das Palmeiras, 77`;

  // ── Portal: serviços do órgão (sem login), requisitos e documentos vindos do catálogo ──
  await page.goto(`/servicos?orgao=${P.sigla}`);
  await expect(page.getByTestId("contexto-orgao")).toBeVisible();
  const apc = page.getByTestId("servico-APC");
  await expect(apc.getByRole("heading", { name: "Autorização de Poda/Corte de Árvore" })).toBeVisible();
  await expect(apc.getByTestId("prazo-servico")).toContainText("até 15 dias");
  await expect(apc.getByTestId("documentos-servico")).toContainText("Foto(s) da árvore");
  await expect(page.getByTestId("servico-ASE")).toContainText("5 dias úteis");
  await expect(page.getByTestId("servico-ACS")).toContainText("CRLV do veículo");
  await expect(page.getByTestId("servico-denuncia").getByRole("link", { name: "Fazer denúncia" })).toHaveAttribute("href", `/denuncia?municipio=${P.sigla}`);

  // "Solicitar" → login do requerente (órgão já escolhido) → wizard com o serviço pré-selecionado
  await apc.getByRole("link", { name: /Solicitar/ }).click();
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByLabel("Órgão")).toHaveValue(P.sigla);
  await page.getByLabel("E-mail").fill(USUARIOS.maria);
  await page.getByLabel("Senha").fill(SENHA_DEMO);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/novo-requerimento\?tipo=APC/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Solicitar Autorização de Poda/Corte de Árvore" })).toBeVisible();
  await aguardar(page);

  const numero = await preencherWizard(page, local, async (pg) => {
    await expect(pg.getByRole("radio", { name: /^APC – / })).toBeChecked();
    const dados = pg.getByTestId("dados-servico");
    await dados.getByLabel("Espécie da árvore (nome popular) *").fill("Oiti");
    await dados.getByLabel("Quantidade de árvores *").fill("1");
    await dados.getByLabel("Intervenção pretendida *").selectOption("Corte (supressão)");
    await dados.getByLabel("Motivo do pedido *").selectOption("Risco à edificação");
    await dados.getByLabel("Onde está a árvore *").selectOption("Quintal ou terreno particular");
    await pg.getByLabel("Observações (opcional)").fill("Raízes levantando o piso da garagem (T15).");
  });

  // ── Técnico: fila /demandas → triagem → vistoria (checklist) → decisão simplificada ──
  await entrarComo(page, "tecnicoPrincipal");
  await abrirDemanda(page, numero);
  const pedido = page.getByTestId("dados-pedido");
  await expect(pedido).toContainText("Oiti");
  await expect(pedido).toContainText("Corte (supressão)");
  await aceitar(page);

  // Sem vistoria o deferimento fica bloqueado
  await expect(page.getByText("Conclua a vistoria para liberar o deferimento.")).toBeVisible();
  const form = page.getByTestId("form-vistoria-demanda");
  await form.getByLabel("Espécie identificada (nome popular/científico) *").fill("Oiti (Moquilea tomentosa)");
  await form.getByLabel("DAP – diâmetro à altura do peito (cm) *").fill("52");
  await form.getByLabel("Altura estimada (m) *").fill("11");
  await form.getByRole("group", { name: /Estado fitossanitário/ }).getByLabel("Ruim (doente/praga)").check();
  await form.getByRole("group", { name: /Risco de queda/ }).getByLabel("Alto").check();
  await form.getByRole("group", { name: /conflito com rede/ }).getByLabel("Sim", { exact: true }).check();
  await form.getByRole("group", { name: /Recomendação técnica/ }).getByLabel("Corte (supressão)").check();
  await form.getByLabel("Compensação ambiental – nº de mudas a plantar *").fill("4");
  await form.getByRole("button", { name: "Concluir vistoria" }).click();
  await expect(page.getByTestId("resumo-vistoria")).toContainText("4 muda(s)", { timeout: 30_000 });
  await aguardar(page);

  // Decisão pelo técnico: condicionantes-padrão já trazem a compensação (texto editável)
  const decisao = page.getByTestId("decisao-demanda");
  await expect(decisao.getByRole("textbox", { name: "Condicionante 4", exact: true })).toHaveValue(/plantar 4 muda\(s\) de espécie\(s\) nativa\(s\)/);
  await decisao.getByLabel("Despacho (opcional)").fill("Deferido conforme vistoria (T15).");
  await decisao.getByRole("button", { name: "Deferir e emitir autorização" }).click();
  await expect(page.getByTestId("status-processo")).toContainText("Concluído", { timeout: 60_000 });

  const docs = page.getByTestId("documentos-emitidos");
  const linha = docs.locator("li").filter({ hasText: new RegExp(`Autorização nº APC-${P.sigla}-\\d{3}/\\d{4}`) });
  await expect(linha).toHaveCount(1);
  const hrefPdf = await linha.getByRole("link", { name: "PDF" }).getAttribute("href");
  const pdf = await page.request.get(hrefPdf!);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // Snapshot do documento: modelo específico de poda e compensação da vistoria
  const doc = await (await page.request.get(hrefPdf!.replace(/\/pdf$/, ""))).json();
  expect(doc.tipo).toBe("AUTORIZACAO");
  expect(doc.dados._contexto.modelo).toBe("embutido:AUTORIZACAO_PODA");
  expect(doc.dados.demanda.vistoria).toMatchObject({ recomendacao: "Corte (supressão)", mudas: 4, dap_cm: 52 });
  expect(doc.dados._contexto.condicionantes.some((c: { descricao: string }) => /plantar 4 muda/.test(c.descricao))).toBe(true);

  // Portal público valida a autorização
  const codigo = (await linha.locator('a[href^="/validar/"]').innerText()).trim();
  await page.goto(`/validar/${codigo}`);
  await expect(page.getByText("Autorização de Poda/Corte de Árvore").first()).toBeVisible();
});

test("T15 – ASE: evento com som deferido com condicionantes de limite em dB(A) e horário; validade = fim do evento", async ({ page }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  test.setTimeout(240_000);
  const local = `Clube E2E ${sufixo()} – Av. Central, 500`;
  const inicio = dataIso(12);
  const fim = dataIso(13);

  await login(page, "maria");
  await page.goto("/servicos");
  await page.getByTestId("servico-ASE").getByRole("link", { name: /Solicitar/ }).click();
  await page.waitForURL(/\/novo-requerimento\?tipo=ASE/);
  await aguardar(page);
  const numero = await preencherWizard(page, local, async (pg) => {
    const d = pg.getByTestId("dados-servico");
    await d.getByLabel("Nome do evento *").fill("Baile da Primavera (T15)");
    await d.getByLabel("Data de início *").fill(inicio);
    await d.getByLabel("Data de término *").fill(fim);
    await d.getByLabel("Horário de início do som *").fill("18:00");
    await d.getByLabel("Horário de término do som *").fill("22:00");
    await d.getByLabel("Estimativa de público (pessoas) *").fill("300");
    await d.getByLabel("Equipamento de som (tipo, potência, nº de caixas) *").fill("2 caixas ativas de 500 W");
    await d.getByLabel("O local fica em área predominantemente residencial? *").selectOption("Não");
  });

  await entrarComo(page, "tecnicoPrincipal");
  await abrirDemanda(page, numero);
  await expect(page.getByTestId("dados-pedido")).toContainText("Baile da Primavera (T15)");
  await aceitar(page);

  // Análise (checklist de emissão sonora) → libera a decisão
  const form = page.getByTestId("form-checklist");
  for (const grupo of await form.locator("fieldset fieldset").all()) await grupo.getByLabel("Sim", { exact: true }).check();
  await form.getByLabel("Limite de pressão sonora aplicável – dB(A)").fill("50");
  await form.getByRole("button", { name: "Salvar checklist" }).click();
  await expect(form.getByRole("status")).toBeVisible({ timeout: 30_000 });
  const decisao = page.getByTestId("decisao-demanda");
  await expect(decisao.getByRole("button", { name: "Deferir e emitir autorização" })).toBeVisible({ timeout: 30_000 });
  await expect(decisao.getByRole("textbox", { name: "Condicionante 1", exact: true })).toHaveValue(/55 dB\(A\).*diurno.*50 dB\(A\).*noturno/);
  await expect(decisao.getByRole("textbox", { name: "Condicionante 2", exact: true })).toHaveValue(/encerrar a emissão sonora às 22:00/);
  // Texto editável: o técnico ajusta a condicionante de horário
  await decisao.getByRole("textbox", { name: "Condicionante 2", exact: true }).fill("Horário limite: encerrar a emissão sonora às 22:00, sem prorrogação (T15).");
  await decisao.getByRole("button", { name: "Deferir e emitir autorização" }).click();
  await expect(page.getByTestId("status-processo")).toContainText("Concluído", { timeout: 60_000 });

  const linha = page.getByTestId("documentos-emitidos").locator("li").filter({ hasText: new RegExp(`Autorização nº ASE-${P.sigla}-`) });
  await expect(linha).toHaveCount(1);
  await expect(linha).toContainText(`válido até ${fim.split("-").reverse().join("/")}`);
  const hrefPdf = await linha.getByRole("link", { name: "PDF" }).getAttribute("href");
  const doc = await (await page.request.get(hrefPdf!.replace(/\/pdf$/, ""))).json();
  expect(doc.dados._contexto.modelo).toBe("embutido:AUTORIZACAO_SOM");
  expect(doc.dados.demanda.limite_db).toBe(50);
  const conds = doc.dados._contexto.condicionantes.map((c: { descricao: string }) => c.descricao).join(" | ");
  expect(conds).toMatch(/dB\(A\)/);
  expect(conds).toContain("sem prorrogação (T15)");
  await expect(page.getByRole("heading", { name: "Condicionantes" })).toBeVisible();
});
