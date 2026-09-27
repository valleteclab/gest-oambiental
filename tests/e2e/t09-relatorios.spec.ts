import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { test, expect, type Page } from "@playwright/test";
import { login, numeroBr } from "./helpers";

// T9 – Relatórios [PoC-9] (SPEC 13). Exporta "Indicadores por município" em PDF e XLSX (tela Relatórios):
// arquivos baixam, PDF válido, XLSX com cabeçalho institucional e os mesmos números da tabela do painel.
// Só gera registro de auditoria: roda nos dois projetos.

// Colunas da tabela do painel (data-col) na ordem do XLSX (após "Município")
const COLS = ["protocolados", "em_andamento", "concluidos", "tempo_medio_dias", "prazo_vencido", "prazo_vencendo", "licencas_emitidas", "licencas_vencendo_90", "denuncias_recebidas", "denuncias_apuradas", "fiscalizacoes", "autos", "multas_total", "notificacoes", "usuarios_ativos", "processos_total"];

async function baixar(page: Page, testId: string) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  expect(await dl.failure()).toBeNull();
  return { nome: dl.suggestedFilename(), buf: readFileSync((await dl.path())!) };
}

const texto = (v: ExcelJS.CellValue) => (v === null || v === undefined ? "" : typeof v === "object" && "richText" in v ? v.richText.map((r) => r.text).join("") : String(v));

test("T9 – Indicadores por município em PDF e XLSX com cabeçalho institucional e os números do painel", async ({ page }) => {
  await login(page, "admin");

  // Números da tela (painel, Todos – sem o parâmetro o painel abriria no órgão ativo)
  await page.goto("/dashboard?municipio=");
  const tabela = page.getByTestId("tabela-municipios");
  await expect(tabela).toBeVisible();
  const tela = new Map<string, (number | null)[]>();
  for (const tr of await tabela.locator("tbody tr, tfoot tr").all()) {
    const nome = (await tr.locator("td").first().innerText()).trim();
    tela.set(nome, await Promise.all(COLS.map(async (c) => numeroBr(await tr.locator(`td[data-col="${c}"]`).innerText()))));
  }
  expect(tela.size).toBe(7); // 6 municípios + Total

  // Tela de relatórios → "Indicadores por município"
  await page.goto("/relatorios");
  const card = page.getByTestId("relatorio-indicadores");
  await expect(card.getByRole("heading")).toContainText("Indicadores por município");

  // PDF
  const pdf = await baixar(page, "relatorio-indicadores-pdf");
  expect(pdf.nome).toMatch(/^relatorio-indicadores-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(pdf.buf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.buf.length).toBeGreaterThan(5_000);

  // XLSX
  const xlsx = await baixar(page, "relatorio-indicadores-xlsx");
  expect(xlsx.nome).toMatch(/^relatorio-indicadores-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(xlsx.buf.subarray(0, 2).toString()).toBe("PK");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  expect(ws.name).toBe("Indicadores por município");

  // Cabeçalho institucional: organização, abrangência, título, filtros, emissão (data + usuário)
  // (linhas mescladas: o texto fica na 1ª célula preenchida; a coluna A pode estar reservada ao brasão)
  const cab = [1, 2, 3, 4, 5, 6].map((r) => texto((ws.getRow(r).values as ExcelJS.CellValue[]).find((v) => texto(v).trim() !== "")).trim());
  expect(cab[0].length).toBeGreaterThan(3);
  expect(cab[1]).toBe("Todos os municípios");
  expect(cab[2]).toBe("Indicadores por município");
  expect(cab[3]).toMatch(/Município: .*Período: \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}/);
  expect(cab[4]).toMatch(/^Emitido em \d{2}\/\d{2}\/\d{4}.* por Ana Administradora – LicenciaGov$/);

  // Tabela: cabeçalho "Município" + mesmas linhas e números da tela
  let hdr = 0;
  ws.eachRow((row, n) => {
    if (!hdr && texto(row.getCell(1).value) === "Município") hdr = n;
  });
  expect(hdr, "linha de cabeçalho da tabela").toBeGreaterThan(5);
  const planilha = new Map<string, (number | null)[]>();
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nome = texto(row.getCell(1).value).trim();
    if (!tela.has(nome)) continue;
    planilha.set(nome, COLS.map((_, i) => {
      const v = row.getCell(i + 2).value;
      return v === null || v === undefined || v === "" ? null : Number(v);
    }));
  }
  expect([...planilha.keys()].sort()).toEqual([...tela.keys()].sort());
  for (const [nome, valores] of tela) {
    const x = planilha.get(nome)!;
    COLS.forEach((c, i) => {
      const esperado = valores[i];
      const obtido = x[i];
      if (esperado === null) expect(obtido, `${nome}/${c}`).toBeNull();
      else if (c === "tempo_medio_dias") expect(Math.round(obtido! * 10) / 10, `${nome}/${c}`).toBe(esperado);
      else expect(obtido, `${nome}/${c}`).toBeCloseTo(esperado, 2);
    });
  }
});
