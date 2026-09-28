import { test, expect, type Page } from "@playwright/test";
import { ANO, DADOS, PDF_EXEMPLO, PROJETO_DESKTOP, apenasNoProjeto, entrarComo, login, reProcesso, salvarEstado } from "./helpers";

// T1 – Processo completo [PoC-1] (SPEC 13).
// Requerente cria LO pelo wizard → protocolo SIG-AAAA-xxxxxx (município principal do dataset) + recibo PDF → gestor distribui ao técnico →
// técnico abre pendência → requerente responde → técnico aceita, preenche checklist e emite parecer
// favorável com condicionantes → gestor defere → LO emitida → linha do tempo completa.
// Altera dados: roda só no projeto desktop. Grava nº do processo e código da LO para T5/T8 (helpers.salvarEstado).

const P = DADOS.principal.sigla;
const EMPREENDIMENTO = DADOS.cenarios.t1.empreendimento;
const REQUERENTE = DADOS.cenarios.t1.requerente;
const TECNICO = DADOS.nomes.tecnicoPrincipal;
const GESTOR = DADOS.nomes.gestorPrincipal;
const DESPACHO_DISTRIBUIR = "Distribuído para análise da LO do laticínio (T1).";
const PENDENCIA = "Apresentar laudo de análise do efluente tratado da ETE (DBO, DQO, óleos e graxas).";
const RESPOSTA = "Segue laudo do laboratório credenciado com os parâmetros solicitados.";
const DESPACHO_ACEITAR = "Documentação completa após resposta à pendência; iniciada a análise técnica.";
const CONDICIONANTE = "Apresentar relatório semestral de monitoramento do efluente tratado.";
const DESPACHO_DEFERIR = "Deferido conforme parecer técnico favorável com condicionantes.";

async function abrirProcesso(page: Page, id: string, aba?: string) {
  const r = await page.goto(`/processos/${id}${aba ? `?aba=${aba}` : ""}`);
  expect(r?.status()).toBe(200);
}

async function executarAcao(page: Page, botao: RegExp | string, preencher?: (painel: ReturnType<Page["locator"]>) => Promise<void>) {
  await page.getByRole("toolbar", { name: "Ações do processo" }).getByRole("button", { name: botao, exact: typeof botao === "string" }).click();
  const painel = page.locator("#painel-acao");
  await expect(painel).toBeVisible();
  if (preencher) await preencher(painel);
  await painel.locator('button[type="submit"]').click();
  // Sucesso: o painel fecha (onConcluido); erro: mensagem role=alert no painel.
  await expect(painel.getByRole("alert")).toHaveCount(0);
  await expect(painel).toBeHidden({ timeout: 30_000 });
}

test("T1 – processo completo de LO: requerimento, pendência, checklist, parecer, deferimento e emissão", async ({ page }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  test.setTimeout(240_000);

  // ── 1. Requerente cria o requerimento de LO pelo wizard ──
  await login(page, "laticinio");
  await page.goto("/novo-requerimento");
  await expect(page.getByRole("heading", { name: /1\. Empreendimento/ })).toBeVisible();
  const selEmp = page.getByLabel("Empreendimento", { exact: true });
  const opcao = selEmp.locator("option", { hasText: EMPREENDIMENTO });
  await expect(opcao).toHaveCount(1);
  await selEmp.selectOption(await opcao.getAttribute("value"));
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /2\. Tipologia e porte/ })).toBeVisible();
  await expect(page.getByLabel("Tipologia da atividade *")).not.toHaveValue("");
  await expect(page.getByTestId("porte-calculado")).not.toHaveText("—");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: /3\. Tipo de ato/ })).toBeVisible();
  await page.getByRole("radio", { name: /^LO – Licença de Operação/ }).check();
  await page.getByLabel("Descrição da atividade").fill("Beneficiamento de leite e fabricação de queijos e iogurtes – 20.000 L/dia, dois turnos.");
  await page.getByRole("button", { name: "Salvar rascunho e continuar" }).click();

  // ── 2. Documentos obrigatórios ──
  await expect(page.getByRole("heading", { name: /4\. Documentos/ })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/novo-requerimento\?id=[0-9a-f-]{36}&passo=4/);
  const processoId = new URL(page.url()).searchParams.get("id")!;
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

  // ── 3. Revisão e protocolo → nº SIG-AAAA-xxxxxx + recibo PDF ──
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByRole("heading", { name: /5\. Revisão e protocolo/ })).toBeVisible();
  await expect(page.getByText("Faltam documentos obrigatórios")).toHaveCount(0);
  await page.getByRole("button", { name: "Protocolar requerimento" }).click();
  await page.waitForURL(new RegExp(`/meus-processos/${processoId}`), { timeout: 30_000 });
  const numero = (await page.getByTestId("numero-processo").innerText()).replace("Processo ", "").trim();
  expect(numero).toMatch(reProcesso(P));
  await expect(page.getByText(`Requerimento protocolado com sucesso sob o nº ${numero}`)).toBeVisible();
  salvarEstado({ processo_id: processoId, processo_numero: numero });

  const docs = page.getByTestId("documentos-emitidos");
  await expect(docs.getByText("Recibo de protocolo")).toBeVisible();
  const hrefRecibo = await docs.locator("li", { hasText: "Recibo de protocolo" }).getByRole("link", { name: "Baixar PDF" }).getAttribute("href");
  const recibo = await page.request.get(hrefRecibo!);
  expect(recibo.status()).toBe(200);
  expect(recibo.headers()["content-type"]).toContain("application/pdf");
  expect((await recibo.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // ── 4. Gestor distribui ao técnico do município principal ──
  await entrarComo(page, "gestorPrincipal");
  await abrirProcesso(page, processoId);
  await expect(page.getByTestId("numero-processo")).toHaveText(numero);
  await executarAcao(page, "Distribuir", async (painel) => {
    await painel.getByLabel("Técnico responsável").selectOption({ label: TECNICO });
    await painel.getByLabel("Despacho (opcional)").fill(DESPACHO_DISTRIBUIR);
  });
  await expect(page.getByText(`Técnico: ${TECNICO}`)).toBeVisible();
  await expect(page.getByTestId("status-processo")).toContainText("Em triagem");

  // ── 5. Técnico abre pendência ──
  await entrarComo(page, "tecnicoPrincipal");
  await abrirProcesso(page, processoId);
  await executarAcao(page, "Abrir pendência", async (painel) => {
    await painel.getByLabel("Pendência 1").fill(PENDENCIA);
    await painel.getByLabel("Prazo para resposta (dias)").fill("15");
  });
  await expect(page.getByTestId("status-processo")).toContainText("Aguardando requerente");

  // ── 6. Requerente responde (texto + anexo) ──
  await entrarComo(page, "laticinio");
  await page.goto(`/meus-processos/${processoId}`);
  const secPend = page.getByRole("region", { name: "Pendência – ação necessária" });
  await expect(secPend.getByText(PENDENCIA)).toBeVisible();
  await secPend.locator('input[type="file"]').setInputFiles(PDF_EXEMPLO);
  await expect(secPend.getByRole("link", { name: "documento-exemplo.pdf" })).toBeVisible({ timeout: 30_000 });
  await secPend.getByLabel("Sua resposta *").fill(RESPOSTA);
  await secPend.getByRole("button", { name: "Enviar resposta ao órgão ambiental" }).click();
  await expect(page.getByRole("region", { name: "Pendência – ação necessária" })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(RESPOSTA)).toBeVisible();

  // ── 7. Técnico aceita, preenche o checklist e emite parecer favorável com condicionantes ──
  await entrarComo(page, "tecnicoPrincipal");
  await abrirProcesso(page, processoId);
  await expect(page.getByTestId("status-processo")).toContainText("Em triagem");
  await executarAcao(page, /^Aceitar/, async (painel) => {
    await painel.getByLabel("Despacho (opcional)").fill(DESPACHO_ACEITAR);
  });
  await expect(page.getByTestId("status-processo")).toContainText("Em análise");

  await abrirProcesso(page, processoId, "checklist");
  const form = page.getByTestId("form-checklist");
  await expect(form).toBeVisible();
  for (const grupo of await form.locator("fieldset fieldset").all()) await grupo.getByLabel("Sim", { exact: true }).check();
  for (const campo of await form.locator('textarea, input[type="text"]').all()) {
    const modo = await campo.getAttribute("inputmode");
    await campo.fill(modo === "decimal" ? "20000" : "Conforme vistoria documental e memorial descritivo.");
  }
  await form.getByRole("button", { name: "Salvar checklist" }).click();
  await expect(form.getByRole("status")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText(/Itens obrigatórios pendentes/)).toHaveCount(0);

  await abrirProcesso(page, processoId, "parecer");
  await expect(page.getByText(/Checklist incompleto/)).toHaveCount(0);
  await page.getByRole("radio", { name: "Favorável com condicionantes" }).check();
  await page.getByLabel("Texto do parecer *").fill(
    "Analisada a documentação apresentada, o sistema de tratamento de efluentes e o laudo complementar, conclui-se pela viabilidade ambiental da operação do empreendimento, observadas as condicionantes abaixo.",
  );
  await page.getByLabel("Descrição", { exact: true }).fill(CONDICIONANTE);
  await page.getByLabel("Periodicidade").fill("semestral");
  await page.getByLabel("Prazo (dias)").fill("180");
  await page.getByRole("button", { name: "Emitir parecer técnico" }).click();
  await expect(page.getByTestId("status-processo")).toContainText("Aguardando decisão", { timeout: 30_000 });

  // ── 8. Gestor defere → LO emitida ──
  await entrarComo(page, "gestorPrincipal");
  await abrirProcesso(page, processoId);
  await executarAcao(page, "Deferir", async (painel) => {
    await painel.getByLabel("Despacho de deferimento (opcional)").fill(DESPACHO_DEFERIR);
  });
  // Se a emissão não for automática no deferimento, o gestor emite o documento.
  const toolbar = page.getByRole("toolbar", { name: "Ações do processo" });
  if (await toolbar.getByRole("button", { name: "Emitir documento" }).isVisible()) await executarAcao(page, "Emitir documento");
  await expect(page.getByTestId("status-processo")).toContainText("Concluído", { timeout: 30_000 });

  await abrirProcesso(page, processoId, "emitidos");
  const linhaLo = page.locator("tr", { hasText: "Licença" }).filter({ hasText: new RegExp(`LO-${P}-`) });
  await expect(linhaLo).toHaveCount(1);
  await expect(linhaLo.getByText("valido")).toBeVisible();
  const loNumero = (await linhaLo.locator("td").nth(1).innerText()).trim();
  expect(loNumero).toMatch(new RegExp(`^LO-${P}-\\d+/${ANO}$`));
  const loCodigo = (await linhaLo.locator('a[href^="/validar/"]').innerText()).trim();
  const loDocId = (await linhaLo.getByRole("link", { name: "PDF" }).getAttribute("href"))!.split("/")[4];
  const pdfLo = await page.request.get(`/api/v1/documentos/${loDocId}/pdf`);
  expect(pdfLo.status()).toBe(200);
  expect((await pdfLo.body()).subarray(0, 5).toString()).toBe("%PDF-");
  salvarEstado({ lo_codigo: loCodigo, lo_numero: loNumero, lo_documento_id: loDocId });

  // ── 9. Linha do tempo com todas as etapas, data, usuário e despacho ──
  await abrirProcesso(page, processoId, "tramitacao");
  const tl = page.getByTestId("linha-do-tempo");
  const etapas: [RegExp, string, string | RegExp][] = [
    [/^Protocolar$/, REQUERENTE, `protocolado sob o nº ${numero}`],
    [/^Distribuir$/, GESTOR, DESPACHO_DISTRIBUIR],
    [/^Abrir pendência$/, TECNICO, PENDENCIA],
    [/^Responder pendência$/, REQUERENTE, /Pendência\(s\) respondida\(s\) pelo requerente/],
    [/^Aceitar/, TECNICO, DESPACHO_ACEITAR],
    [/^Emitir parecer$/, TECNICO, /favorável com condicionantes/],
    [/^Deferir$/, GESTOR, DESPACHO_DEFERIR],
    [/^Emitir documento$/, GESTOR, `${loNumero} emitido`],
  ];
  for (const [rotulo, usuario, despacho] of etapas) {
    const item = tl.locator(":scope > li").filter({ has: page.locator("span.font-semibold", { hasText: rotulo }) }).first();
    await expect(item, `etapa ${rotulo}`).toBeVisible();
    await expect(item.locator("time")).toHaveText(/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}/);
    await expect(item.getByText(`por ${usuario}`, { exact: false })).toBeVisible();
    await expect(item.locator("p.whitespace-pre-line")).toContainText(despacho);
  }
  // Todas as movimentações têm data e autor
  for (const li of await tl.locator(":scope > li").all()) {
    await expect(li.locator("time")).toHaveText(/\d{2}\/\d{2}\/\d{4}/);
    await expect(li.getByText(/^por /)).toBeVisible();
  }
});
