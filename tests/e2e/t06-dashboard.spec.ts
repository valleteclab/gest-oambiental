import { test, expect, type Page } from "@playwright/test";
import { DADOS, login, numeroBr } from "./helpers";

// T6 – Dashboard [PoC-6] (SPEC 13). Somente leitura: roda nos dois projetos.
// Filtro pelo município principal do dataset (demo: Lagoa do Orvalho; PoC: Itaberaba) e depois "Todos": cards, gráficos e tabela por município mudam coerentemente.

const KPIS = ["kpi-protocolados", "kpi-em-andamento", "kpi-concluidos", "kpi-prazo-vencido", "kpi-prazo-vencendo", "kpi-licencas", "kpi-licencas-vencendo", "kpi-fiscalizacoes", "kpi-autos", "kpi-notificacoes"] as const;
// KPI → coluna da tabela por município (mesma métrica)
const COLUNA: Record<(typeof KPIS)[number], string> = {
  "kpi-protocolados": "protocolados",
  "kpi-em-andamento": "em_andamento",
  "kpi-concluidos": "concluidos",
  "kpi-prazo-vencido": "prazo_vencido",
  "kpi-prazo-vencendo": "prazo_vencendo",
  "kpi-licencas": "licencas_emitidas",
  "kpi-licencas-vencendo": "licencas_vencendo_90",
  "kpi-fiscalizacoes": "fiscalizacoes",
  "kpi-autos": "autos",
  "kpi-notificacoes": "notificacoes",
};

type Visao = { kpis: Record<string, number>; linhas: Record<string, Record<string, number | null>>; total: Record<string, number | null>; status: number[]; tipos: number[]; barrasStatus: number };

async function lerVisao(page: Page): Promise<Visao> {
  await expect(page.getByTestId("tabela-municipios")).toBeVisible();
  const kpis: Record<string, number> = {};
  for (const k of KPIS) kpis[k] = numeroBr(await page.getByTestId(k).innerText())!;
  const lerLinha = async (loc: ReturnType<Page["locator"]>) => {
    const r: Record<string, number | null> = {};
    for (const td of await loc.locator("td[data-col]").all()) r[(await td.getAttribute("data-col"))!] = numeroBr(await td.innerText());
    return r;
  };
  const linhas: Visao["linhas"] = {};
  for (const tr of await page.getByTestId("tabela-municipios").locator("tbody tr").all()) {
    linhas[(await tr.getAttribute("data-testid"))!.replace("linha-municipio-", "")] = await lerLinha(tr);
  }
  const serie = async (caption: string) =>
    (await page.locator("table", { has: page.locator("caption", { hasText: caption }) }).locator("tbody tr td:last-child").allTextContents()).map((t) => numeroBr(t)!);
  const barras = page.getByTestId("grafico-status").locator(".recharts-bar-rectangle");
  return {
    kpis,
    linhas,
    total: await lerLinha(page.getByTestId("linha-municipio-total")),
    status: await serie("Processos por status"),
    tipos: await serie("Processos por tipo de ato"),
    barrasStatus: await barras.count(),
  };
}

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const { sigla: P, nome: NOME_P } = DADOS.principal;
const N_MUNICIPIOS = DADOS.municipios.length;

test(`T6 – painel filtrado por ${NOME_P} e por Todos muda cards, gráficos e tabela coerentemente`, async ({ page }) => {
  await login(page, "admin"); // órgão escolhido no login: município principal
  await page.goto("/dashboard");
  const filtro = page.getByTestId("filtro-municipio");
  // Sem filtro na URL, o painel abre no órgão ativo (admin tem escopo amplo); "Todos" continua disponível
  await expect(page.getByTestId("dashboard-escopo")).toContainText(NOME_P);
  await expect(filtro.locator("option:checked")).toHaveText(NOME_P);
  await filtro.selectOption({ label: "Todos" });
  await expect(page).toHaveURL(/municipio=(&|$)/);
  await expect(filtro).toHaveValue("");
  await expect(page.getByTestId("dashboard-escopo")).toContainText("Todos");
  await expect(page.getByTestId("grafico-status").locator(".recharts-bar-rectangle").first()).toBeVisible();
  const todos = await lerVisao(page);

  // Todos: todos os municípios do dataset na tabela; cards = linha Total = soma das linhas; gráficos somam o card
  expect(Object.keys(todos.linhas)).toHaveLength(N_MUNICIPIOS);
  for (const k of KPIS) {
    expect(todos.total[COLUNA[k]], k).toBe(todos.kpis[k]);
    expect(soma(Object.values(todos.linhas).map((l) => l[COLUNA[k]] ?? 0)), k).toBe(todos.kpis[k]);
  }
  expect(soma(todos.status)).toBe(todos.kpis["kpi-protocolados"]);
  expect(soma(todos.tipos)).toBe(todos.kpis["kpi-protocolados"]);
  expect(todos.barrasStatus).toBe(todos.status.length);

  // ── Município principal ──
  const linhaP = todos.linhas[P];
  expect(linhaP, `linha de ${NOME_P} no painel Todos`).toBeTruthy();
  await filtro.selectOption({ label: NOME_P });
  await expect(page).toHaveURL(/municipio=[0-9a-f-]{36}/);
  await expect(page.getByTestId("dashboard-escopo")).toContainText(NOME_P);
  await expect(page.getByTestId("tabela-municipios").locator("tbody tr")).toHaveCount(1);
  const vPrincipal = await lerVisao(page);
  expect(Object.keys(vPrincipal.linhas)).toEqual([P]);
  // A linha do município é idêntica nas duas visões e os cards batem com ela
  expect(vPrincipal.linhas[P]).toEqual(linhaP);
  for (const k of KPIS) {
    expect(vPrincipal.kpis[k], k).toBe(linhaP[COLUNA[k]]);
    expect(vPrincipal.kpis[k], k).toBeLessThanOrEqual(todos.kpis[k]);
  }
  expect(vPrincipal.kpis["kpi-protocolados"]).toBeLessThan(todos.kpis["kpi-protocolados"]);
  // Gráficos acompanham o filtro
  expect(soma(vPrincipal.status)).toBe(vPrincipal.kpis["kpi-protocolados"]);
  expect(soma(vPrincipal.tipos)).toBe(vPrincipal.kpis["kpi-protocolados"]);
  expect(vPrincipal.barrasStatus).toBe(vPrincipal.status.length);
  expect(soma(vPrincipal.status)).toBeLessThan(soma(todos.status));

  // ── De volta a Todos: mesmos números do início ──
  await page.getByTestId("filtro-municipio").selectOption({ label: "Todos" });
  await expect(page.getByTestId("dashboard-escopo")).toContainText("Todos");
  await expect(page.getByTestId("tabela-municipios").locator("tbody tr")).toHaveCount(N_MUNICIPIOS);
  const denovo = await lerVisao(page);
  expect(denovo.kpis).toEqual(todos.kpis);
  expect(denovo.linhas).toEqual(todos.linhas);
  expect(denovo.status).toEqual(todos.status);
});
